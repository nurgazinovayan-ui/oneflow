// Reads an uploaded .docx / .xlsx / .pptx and turns it into markdown, entirely in the browser.
//
// The chat model only ever sees text, so an Office file the user drops into "Работа с текстом"
// has to be unpacked here first. Each format is a zip of XML parts (JSZip is already bundled —
// see deliverables.ts, which writes the same formats back out), so this reads the few parts that
// actually carry content and ignores styling, revisions, drawings and everything else.
//
// This is deliberately a content reader, not a fidelity-preserving converter: the point is that
// the model can read the document and hand back an edited version through the oneflow-document
// block, which deliverables.ts then rebuilds as a fresh, properly styled file.

import JSZip from 'jszip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const OFFICE_EXTENSIONS = ['.docx', '.xlsx', '.pptx'] as const;

export function officeExtension(name: string): (typeof OFFICE_EXTENSIONS)[number] | null {
  const lower = name.toLowerCase();
  return OFFICE_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null;
}

// The pre-XML Office formats (.doc/.xls/.ppt) are binary blobs, not zips — worth naming them in
// the error so the user knows to re-save rather than assuming the upload is broken.
export function isLegacyOfficeFile(name: string): boolean {
  return /\.(doc|xls|ppt)$/i.test(name);
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('bad-xml');
  return doc;
}

async function readPart(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path);
  if (!file) return null;
  return parseXml(await file.async('string'));
}

function children(node: Element, ns: string, name: string): Element[] {
  return [...node.childNodes].filter(
    (n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === name
  );
}

function firstChild(node: Element, ns: string, name: string): Element | null {
  return children(node, ns, name)[0] ?? null;
}

function allText(node: Element, ns: string): string {
  return [...node.getElementsByTagNameNS(ns, 't')].map((t) => t.textContent ?? '').join('');
}

// --- DOCX ---------------------------------------------------------------------------------

// <w:b/> means on, <w:b w:val="false"/> means off — the attribute form is what docx.js writes,
// so a naive "the element exists" check would bold the entire document.
function isOn(rPr: Element | null, name: string): boolean {
  if (!rPr) return false;
  const el = firstChild(rPr, W_NS, name);
  if (!el) return false;
  const val = el.getAttributeNS(W_NS, 'val') ?? el.getAttribute('w:val');
  return val !== 'false' && val !== '0';
}

function runText(run: Element): string {
  let text = '';
  for (const node of [...run.childNodes]) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.namespaceURI !== W_NS) continue;
    if (el.localName === 't') text += el.textContent ?? '';
    else if (el.localName === 'tab') text += '\t';
    else if (el.localName === 'br') text += ' ';
  }
  return text;
}

function paragraphText(p: Element): string {
  let out = '';
  for (const run of children(p, W_NS, 'r')) {
    const text = runText(run);
    if (!text) continue;
    const rPr = firstChild(run, W_NS, 'rPr');
    const bold = isOn(rPr, 'b');
    const italic = isOn(rPr, 'i');
    // Markers go outside the run's own leading/trailing spaces, or "**text **" breaks rendering.
    const lead = text.match(/^\s*/)?.[0] ?? '';
    const tail = text.match(/\s*$/)?.[0] ?? '';
    const core = text.slice(lead.length, text.length - tail.length);
    if (!core) {
      out += text;
      continue;
    }
    const marks = (bold ? '**' : '') + (italic ? '*' : '');
    out += lead + marks + core + [...marks].reverse().join('') + tail;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function paragraphMarkdown(p: Element): string {
  const text = paragraphText(p);
  if (!text) return '';
  const pPr = firstChild(p, W_NS, 'pPr');
  const styleEl = pPr ? firstChild(pPr, W_NS, 'pStyle') : null;
  const style = styleEl?.getAttributeNS(W_NS, 'val') ?? styleEl?.getAttribute('w:val') ?? '';
  const heading = /^Heading(\d)$/i.exec(style);
  if (heading) return `${'#'.repeat(Math.min(Number(heading[1]) + 1, 6))} ${text}`;
  if (/^Title$/i.test(style)) return `# ${text}`;
  // numbering.xml would say whether a list is bulleted or numbered; a bullet reads correctly
  // either way once the model rewrites it, so the distinction isn't worth resolving here.
  if (pPr && firstChild(pPr, W_NS, 'numPr')) return `- ${text}`;
  return text;
}

function tableMarkdown(tbl: Element): string[] {
  const rows = children(tbl, W_NS, 'tr').map((tr) =>
    children(tr, W_NS, 'tc').map((tc) =>
      children(tc, W_NS, 'p')
        .map(paragraphText)
        .filter(Boolean)
        .join(' ')
        .replace(/\|/g, '\\|')
    )
  );
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? '');
  const [header, ...body] = rows;
  return [
    `| ${pad(header).join(' | ')} |`,
    `|${' --- |'.repeat(width)}`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`),
  ];
}

async function docxToMarkdown(zip: JSZip): Promise<string> {
  const doc = await readPart(zip, 'word/document.xml');
  const body = doc ? doc.getElementsByTagNameNS(W_NS, 'body')[0] : null;
  if (!body) throw new Error('unreadable');

  const lines: string[] = [];
  for (const node of [...body.childNodes]) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.namespaceURI !== W_NS) continue;
    if (el.localName === 'p') {
      const md = paragraphMarkdown(el);
      if (!md) continue;
      // One blank line between blocks, never a run of them — but consecutive list items belong
      // to one list, and a blank line between them reads as several one-item lists.
      if (md.startsWith('- ') && lines[lines.length - 2]?.startsWith('- ')) lines.pop();
      lines.push(md, '');
    } else if (el.localName === 'tbl') {
      lines.push(...tableMarkdown(el), '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- XLSX ---------------------------------------------------------------------------------

function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(n - 1, 0);
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const doc = await readPart(zip, 'xl/sharedStrings.xml');
  if (!doc) return [];
  return [...doc.getElementsByTagNameNS(S_NS, 'si')].map((si) => allText(si, S_NS));
}

function sheetRows(sheet: Document, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of [...sheet.getElementsByTagNameNS(S_NS, 'row')]) {
    const cells: string[] = [];
    for (const c of children(row, S_NS, 'c')) {
      const at = columnIndex(c.getAttribute('r') ?? '');
      const type = c.getAttribute('t');
      let value = '';
      if (type === 's') {
        const index = Number(firstChild(c, S_NS, 'v')?.textContent ?? '');
        value = strings[index] ?? '';
      } else if (type === 'inlineStr') {
        const is = firstChild(c, S_NS, 'is');
        value = is ? allText(is, S_NS) : '';
      } else {
        // A formula cell carries its last cached result in <v>; that value is what the user sees.
        value = firstChild(c, S_NS, 'v')?.textContent ?? '';
      }
      while (cells.length < at) cells.push('');
      cells[at] = value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    }
    rows.push(cells);
  }
  // Excel keeps styled-but-empty rows and columns; they'd become a wall of empty pipes.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

async function xlsxToMarkdown(zip: JSZip): Promise<string> {
  const workbook = await readPart(zip, 'xl/workbook.xml');
  const rels = await readPart(zip, 'xl/_rels/workbook.xml.rels');
  if (!workbook) throw new Error('unreadable');

  const targets = new Map<string, string>();
  if (rels) {
    for (const rel of [...rels.getElementsByTagName('Relationship')]) {
      targets.set(rel.getAttribute('Id') ?? '', (rel.getAttribute('Target') ?? '').replace(/^\/?xl\//, ''));
    }
  }

  const strings = await sharedStrings(zip);
  const lines: string[] = [];
  const sheets = [...workbook.getElementsByTagNameNS(S_NS, 'sheet')];
  for (const [i, sheet] of sheets.entries()) {
    const name = sheet.getAttribute('name') ?? `Лист ${i + 1}`;
    const relId = sheet.getAttributeNS(R_NS, 'id') ?? sheet.getAttribute('r:id') ?? '';
    const path = `xl/${targets.get(relId) ?? `worksheets/sheet${i + 1}.xml`}`;
    const doc = await readPart(zip, path);
    if (!doc) continue;
    const rows = sheetRows(doc, strings);
    lines.push(`## ${name}`, '');
    if (rows.length === 0) {
      lines.push('(пустой лист)', '');
      continue;
    }
    const width = Math.max(...rows.map((r) => r.length), 1);
    const pad = (row: string[]) => Array.from({ length: width }, (_, c) => row[c] ?? '');
    const [header, ...body] = rows;
    lines.push(`| ${pad(header).join(' | ')} |`, `|${' --- |'.repeat(width)}`);
    for (const row of body) lines.push(`| ${pad(row).join(' | ')} |`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

// --- PPTX ---------------------------------------------------------------------------------

// Each <a:p> is one paragraph of one shape. The run size comes along because a deck built from
// a blank layout has no title placeholder at all — there, the biggest text on the slide is what
// actually reads as its title.
interface SlideParagraph {
  text: string;
  size: number;
}

function shapeParagraphs(sp: Element): SlideParagraph[] {
  return [...sp.getElementsByTagNameNS(A_NS, 'p')]
    .map((p) => ({
      text: [...p.getElementsByTagNameNS(A_NS, 't')]
        .map((t) => t.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
      size: Math.max(
        0,
        ...[...p.getElementsByTagNameNS(A_NS, 'rPr')].map((rPr) => Number(rPr.getAttribute('sz') ?? 0))
      ),
    }))
    .filter((p) => p.text);
}

function placeholderType(sp: Element): string {
  return sp.getElementsByTagNameNS(P_NS, 'ph')[0]?.getAttribute('type') ?? '';
}

// Slide numbers, footers and dates are chrome, not content — in a deck that puts them in real
// placeholders this is all it takes; the repeated-text pass below catches the rest.
const CHROME_PLACEHOLDERS = ['sldNum', 'ftr', 'dt'];

interface RawSlide {
  title: string;
  bullets: string[];
  notes: string;
}

async function pptxToMarkdown(zip: JSZip): Promise<string> {
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  if (slidePaths.length === 0) throw new Error('unreadable');

  const slides: RawSlide[] = [];
  for (const [i, path] of slidePaths.entries()) {
    const doc = await readPart(zip, path);
    if (!doc) continue;

    let title = '';
    const body: SlideParagraph[] = [];
    for (const sp of [...doc.getElementsByTagNameNS(P_NS, 'sp')]) {
      const ph = placeholderType(sp);
      if (CHROME_PLACEHOLDERS.includes(ph)) continue;
      const paragraphs = shapeParagraphs(sp);
      if (paragraphs.length === 0) continue;
      if (!title && (ph === 'title' || ph === 'ctrTitle')) title = paragraphs.map((p) => p.text).join(' ');
      else body.push(...paragraphs);
    }
    if (!title && body.length > 0) {
      // No title placeholder: the largest text on the slide is the one a viewer reads as the
      // heading — on a cover that's the title itself, not the small label sitting above it.
      const biggest = body.reduce((best, p) => (p.size > best.size ? p : best), body[0]);
      title = biggest.text;
      body.splice(body.indexOf(biggest), 1);
    }

    const notesDoc = await readPart(zip, `ppt/notesSlides/notesSlide${i + 1}.xml`);
    const notes = notesDoc
      ? [...notesDoc.getElementsByTagNameNS(P_NS, 'sp')]
          .filter((sp) => !CHROME_PLACEHOLDERS.includes(placeholderType(sp)) && placeholderType(sp) !== 'title')
          .flatMap(shapeParagraphs)
          .map((p) => p.text)
          .join(' ')
          .trim()
      : '';

    slides.push({
      title: title || `Слайд ${i + 1}`,
      // A lone number is a page number wherever it sits, placeholder or plain text box.
      bullets: body.map((p) => p.text).filter((t) => !/^\d+$/.test(t)),
      notes,
    });
  }

  // Anything repeating across most slides is running chrome (a footer, a deck title, a brand
  // mark) that a plain text box hides from the placeholder check above.
  if (slides.length >= 3) {
    const seen = new Map<string, number>();
    for (const slide of slides) {
      for (const text of new Set(slide.bullets)) seen.set(text, (seen.get(text) ?? 0) + 1);
    }
    const threshold = Math.ceil(slides.length * 0.6);
    const chrome = new Set([...seen].filter(([, n]) => n >= threshold).map(([text]) => text));
    for (const slide of slides) slide.bullets = slide.bullets.filter((t) => !chrome.has(t));
  }

  const lines: string[] = [];
  for (const slide of slides) {
    lines.push(`## ${slide.title}`, '');
    for (const b of slide.bullets) lines.push(`- ${b}`);
    if (slide.notes) lines.push('', `Заметки: ${slide.notes}`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- Entry point ----------------------------------------------------------------------------

// Throws 'unreadable' when the file is a zip but not the Office part layout we expect (a renamed
// file, or a format variant with no document part) — callers surface that as its own message.
export async function officeFileToMarkdown(file: File): Promise<string> {
  const ext = officeExtension(file.name);
  if (!ext) throw new Error('unsupported');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('unreadable');
  }
  const markdown =
    ext === '.docx' ? await docxToMarkdown(zip) : ext === '.xlsx' ? await xlsxToMarkdown(zip) : await pptxToMarkdown(zip);
  if (!markdown.trim()) throw new Error('unreadable');
  return markdown;
}
