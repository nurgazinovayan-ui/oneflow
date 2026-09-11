// Parses the optional ```oneflow-document fenced JSON block the Работа с текстом chat can
// emit (see TEXT_CHAT_SYSTEM_PROMPT in electron/main.ts / supabase/functions/generate-chat)
// and turns it into an actual downloadable .docx or .pptx file, built entirely client-side —
// the model only ever returns structured text content, never binary output.

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { inlineText, parseMarkdown, type Block, type Inline } from './markdown';

interface DocumentSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface ParsedDocument {
  kind: 'document';
  title: string;
  sections: DocumentSection[];
}

interface PresentationSlide {
  title: string;
  bullets?: string[];
  notes?: string;
}

export interface ParsedPresentation {
  kind: 'presentation';
  title: string;
  slides: PresentationSlide[];
}

export type ParsedDeliverable = ParsedDocument | ParsedPresentation;

const DOCUMENT_BLOCK_RE = /```oneflow-document\s*([\s\S]*?)```/i;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter(isNonEmptyString);
  return arr.length > 0 ? arr : undefined;
}

export interface ParsedDeliverableResult {
  cleanedText: string;
  deliverable: ParsedDeliverable | null;
}

export function parseDeliverable(text: string): ParsedDeliverableResult {
  const match = DOCUMENT_BLOCK_RE.exec(text);
  if (!match) return { cleanedText: text, deliverable: null };

  const cleanedText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (!isNonEmptyString(parsed.title)) return { cleanedText, deliverable: null };

    if (parsed.kind === 'document' && Array.isArray(parsed.sections)) {
      const sections: DocumentSection[] = parsed.sections
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s) => ({
          heading: isNonEmptyString(s.heading) ? s.heading : undefined,
          paragraphs: toStringArray(s.paragraphs),
          bullets: toStringArray(s.bullets),
        }));
      if (sections.length === 0) return { cleanedText, deliverable: null };
      return { cleanedText, deliverable: { kind: 'document', title: parsed.title, sections } };
    }

    if (parsed.kind === 'presentation' && Array.isArray(parsed.slides)) {
      const slides: PresentationSlide[] = parsed.slides
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s) => ({
          title: isNonEmptyString(s.title) ? s.title : '',
          bullets: toStringArray(s.bullets),
          notes: isNonEmptyString(s.notes) ? s.notes : undefined,
        }))
        .filter((s) => s.title);
      if (slides.length === 0) return { cleanedText, deliverable: null };
      return { cleanedText, deliverable: { kind: 'presentation', title: parsed.title, slides } };
    }

    return { cleanedText, deliverable: null };
  } catch {
    return { cleanedText, deliverable: null };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function buildDocxDataUrl(doc: ParsedDocument): Promise<string> {
  const children: Paragraph[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE })];
  for (const section of doc.sections) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    }
    for (const p of section.paragraphs ?? []) {
      children.push(new Paragraph({ text: p }));
    }
    for (const b of section.bullets ?? []) {
      children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    }
  }
  const file = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(file);
  return blobToDataUrl(blob);
}

export async function buildPptxDataUrl(pres: ParsedPresentation): Promise<string> {
  const pptx = new PptxGenJS();

  const titleSlide = pptx.addSlide();
  titleSlide.addText(pres.title, {
    x: 0.5,
    y: 2,
    w: 9,
    h: 1.5,
    fontSize: 32,
    bold: true,
    align: 'center',
  });

  for (const slide of pres.slides) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true });
    if (slide.bullets && slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 16 }
      );
    }
    if (slide.notes) s.addNotes(slide.notes);
  }

  const base64 = (await pptx.write({ outputType: 'base64' })) as string;
  return `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64}`;
}

export function suggestedFileName(deliverable: ParsedDeliverable): string {
  const safeTitle = deliverable.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'ONEFLOW';
  return deliverable.kind === 'document' ? `${safeTitle}.docx` : `${safeTitle}.pptx`;
}

// --- Export any chat answer, not just the ones the model wrapped in an oneflow-document block ---
//
// The structured block above produces a nicer file when the model bothers to emit it, but it only
// fires when the model decides to. Everything below converts an ordinary markdown answer into a
// real .docx/.xlsx/.pptx on demand, so "save this as Word" always works.

export type ExportFormat = 'docx' | 'xlsx' | 'pptx';

export function exportFileName(title: string, format: ExportFormat): string {
  const safeTitle = title.replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safeTitle || 'ONEFLOW'}.${format}`;
}

function inlinesToRuns(inlines: Inline[]): TextRun[] {
  return inlines.map(
    (part) =>
      new TextRun({
        text: part.text,
        bold: part.type === 'bold',
        italics: part.type === 'italic',
        font: part.type === 'code' ? 'Consolas' : undefined,
      })
  );
}

function blocksToDocxChildren(blocks: Block[]): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({
            children: inlinesToRuns(block.inlines),
            heading:
              block.level <= 1
                ? HeadingLevel.HEADING_1
                : block.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
          })
        );
        break;
      case 'list':
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: inlinesToRuns(item),
              ...(block.ordered ? { numbering: { reference: 'md-numbers', level: 0 } } : { bullet: { level: 0 } }),
            })
          );
        }
        break;
      case 'code':
        for (const line of block.text.split('\n')) {
          children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
        }
        break;
      case 'table':
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: block.header.map(() => Math.floor(9000 / Math.max(block.header.length, 1))),
            rows: [block.header, ...block.rows].map(
              (row, rowIndex) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        width: {
                          size: Math.floor(9000 / Math.max(block.header.length, 1)),
                          type: WidthType.DXA,
                        },
                        children: [
                          new Paragraph({ children: [new TextRun({ text: cell, bold: rowIndex === 0 })] }),
                        ],
                      })
                  ),
                })
            ),
          })
        );
        children.push(new Paragraph({ text: '' }));
        break;
      default:
        children.push(new Paragraph({ children: inlinesToRuns(block.inlines) }));
    }
  }
  return children.length > 0 ? children : [new Paragraph({ text: '' })];
}

export async function buildDocxFromMarkdown(markdown: string, title: string): Promise<string> {
  const blocks = parseMarkdown(markdown);
  const file = new Document({
    numbering: {
      config: [
        {
          reference: 'md-numbers',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }],
        },
      ],
    },
    sections: [
      {
        children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...blocksToDocxChildren(blocks)],
      },
    ],
  });
  return blobToDataUrl(await Packer.toBlob(file));
}

export async function buildPptxFromMarkdown(markdown: string, title: string): Promise<string> {
  const blocks = parseMarkdown(markdown);
  const pptx = new PptxGenJS();

  const cover = pptx.addSlide();
  cover.addText(title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 32, bold: true, align: 'center' });

  // Each heading opens a slide; the blocks under it become that slide's bullets. Content before
  // the first heading (or an answer with no headings at all) goes onto one leading slide.
  let current: { title: string; bullets: string[] } = { title, bullets: [] };
  const slides: { title: string; bullets: string[] }[] = [current];
  for (const block of blocks) {
    if (block.type === 'heading') {
      current = { title: inlineText(block.inlines), bullets: [] };
      slides.push(current);
    } else if (block.type === 'list') {
      current.bullets.push(...block.items.map(inlineText));
    } else if (block.type === 'paragraph') {
      current.bullets.push(inlineText(block.inlines));
    } else if (block.type === 'table') {
      current.bullets.push(...block.rows.map((row) => row.join(' — ')));
    }
  }

  for (const slide of slides.filter((s) => s.bullets.length > 0)) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 24, bold: true });
    s.addText(
      slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
      { x: 0.5, y: 1.3, w: 9, h: 4.5, fontSize: 16 }
    );
  }

  const base64 = (await pptx.write({ outputType: 'base64' })) as string;
  return `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64}`;
}

// --- XLSX ---------------------------------------------------------------------------------
// Written by hand rather than pulling in a spreadsheet library: an .xlsx is a zip of five small
// XML parts, and JSZip is already in the bundle (pptxgenjs builds its .pptx with it). Strings go
// in as inline values, which skips the shared-string table entirely.

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are illegal in XML 1.0 and Excel refuses the whole file over one.
    .replace(/[ --]/g, '');
}

function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;

function cellXml(value: string, ref: string): string {
  const text = value ?? '';
  if (text.trim() === '') return '';
  if (NUMERIC_RE.test(text.trim())) {
    return `<c r="${ref}"><v>${text.trim().replace(',', '.')}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((cells, r) => {
      const rowNumber = r + 1;
      const cellsXml = cells.map((value, c) => cellXml(value, `${columnName(c)}${rowNumber}`)).join('');
      return `<row r="${rowNumber}">${cellsXml}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

// A markdown answer isn't inherently tabular, so tables become real rows and everything else
// becomes one-cell rows — the export always carries the full answer rather than silently
// dropping the parts that don't fit a grid.
function blocksToRows(blocks: Block[]): string[][] {
  const rows: string[][] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'table':
        rows.push(block.header, ...block.rows, []);
        break;
      case 'list':
        for (const item of block.items) rows.push([inlineText(item)]);
        break;
      case 'heading':
        if (rows.length > 0) rows.push([]);
        rows.push([inlineText(block.inlines)]);
        break;
      case 'code':
        for (const line of block.text.split('\n')) rows.push([line]);
        break;
      default:
        rows.push([inlineText(block.inlines)]);
    }
  }
  return rows;
}

export async function buildXlsxFromMarkdown(markdown: string, title: string): Promise<string> {
  const rows = blocksToRows(parseMarkdown(markdown));
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>'
  );

  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  );

  // Sheet names can't exceed 31 chars or contain []:*?/\ — Excel rejects the file outright.
  const sheetName = (title.replace(/[[\]:*?/\\]/g, ' ').trim() || 'ONEFLOW').slice(0, 31);
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>'
  );

  zip.file('xl/worksheets/sheet1.xml', sheetXml(rows.length > 0 ? rows : [['']]));

  const base64 = await zip.generateAsync({ type: 'base64' });
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
}

export function buildExport(markdown: string, title: string, format: ExportFormat): Promise<string> {
  if (format === 'docx') return buildDocxFromMarkdown(markdown, title);
  if (format === 'xlsx') return buildXlsxFromMarkdown(markdown, title);
  return buildPptxFromMarkdown(markdown, title);
}
