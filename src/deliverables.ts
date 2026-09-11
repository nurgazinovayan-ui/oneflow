// Parses the optional ```oneflow-document fenced JSON block the Работа с текстом chat can
// emit (see TEXT_CHAT_SYSTEM_PROMPT in electron/main.ts / supabase/functions/generate-chat)
// and turns it into an actual .docx / .xlsx / .pptx file, built entirely client-side — the
// model only ever returns structured text content, never binary output.
//
// Both entry points (a structured deliverable, or any plain markdown answer) are normalised
// into one DocContent shape first, so a file downloaded from the chat card and a file exported
// from the same answer through the download menu come out of the same styling engine.

import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { inlineText, parseInline, parseMarkdown, type Block, type Inline } from './markdown';

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

interface SpreadsheetSheet {
  name: string;
  columns: string[];
  rows: string[][];
}

export interface ParsedSpreadsheet {
  kind: 'spreadsheet';
  title: string;
  sheets: SpreadsheetSheet[];
}

export type ParsedDeliverable = ParsedDocument | ParsedPresentation | ParsedSpreadsheet;

export type ExportFormat = 'docx' | 'xlsx' | 'pptx';

// What each kind downloads as when the user just hits "Скачать" on the chat card.
export const DEFAULT_FORMAT: Record<ParsedDeliverable['kind'], ExportFormat> = {
  document: 'docx',
  presentation: 'pptx',
  spreadsheet: 'xlsx',
};

const DOCUMENT_BLOCK_RE = /```oneflow-document\s*([\s\S]*?)```/i;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter(isNonEmptyString);
  return arr.length > 0 ? arr : undefined;
}

// Spreadsheet cells arrive as strings or as numbers depending on the model's mood; both are fine.
function toCellRow(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
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

    if (parsed.kind === 'spreadsheet' && Array.isArray(parsed.sheets)) {
      const sheets: SpreadsheetSheet[] = parsed.sheets
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s, i) => ({
          name: isNonEmptyString(s.name) ? s.name : `${parsed.title as string} ${i + 1}`,
          columns: toCellRow(s.columns) ?? [],
          rows: (Array.isArray(s.rows) ? s.rows : []).map(toCellRow).filter((r): r is string[] => r !== null),
        }))
        .filter((s) => s.columns.length > 0 || s.rows.length > 0);
      if (sheets.length === 0) return { cleanedText, deliverable: null };
      return { cleanedText, deliverable: { kind: 'spreadsheet', title: parsed.title, sheets } };
    }

    return { cleanedText, deliverable: null };
  } catch {
    return { cleanedText, deliverable: null };
  }
}

// --- Normalised content ---------------------------------------------------------------------
// Block[] (from markdown.ts) is the common currency: the DOCX renderer walks it directly, the
// PPTX renderer folds it into slides, the XLSX renderer folds it into rows.

interface Slide {
  title: string;
  bullets: string[];
  notes?: string;
}

type RowStyle = 'title' | 'section' | 'header' | 'cell' | 'band' | 'text' | 'blank';

interface SheetRow {
  cells: string[];
  style: RowStyle;
}

interface SheetData {
  name: string;
  rows: SheetRow[];
  frozen: boolean;
}

export interface DocContent {
  title: string;
  blocks: Block[];
  slides: Slide[];
  sheets: SheetData[];
}

// A heading opens a slide; everything under it becomes that slide's bullets. Content before the
// first heading (or an answer with no headings at all) goes onto one leading slide.
function blocksToSlides(blocks: Block[], title: string): Slide[] {
  let current: Slide = { title, bullets: [] };
  const slides: Slide[] = [current];
  for (const block of blocks) {
    if (block.type === 'heading') {
      current = { title: inlineText(block.inlines), bullets: [] };
      slides.push(current);
    } else if (block.type === 'list') {
      current.bullets.push(...block.items.map(inlineText));
    } else if (block.type === 'paragraph') {
      current.bullets.push(inlineText(block.inlines));
    } else if (block.type === 'table') {
      current.bullets.push(block.header.join(' · '), ...block.rows.map((row) => row.join(' — ')));
    }
  }
  return slides.filter((s) => s.bullets.length > 0);
}

// A markdown answer isn't inherently tabular, so tables become real rows and everything else
// becomes one-cell rows — the export always carries the full answer rather than silently
// dropping the parts that don't fit a grid.
function blocksToSheet(blocks: Block[], title: string): SheetData {
  const rows: SheetRow[] = [{ cells: [title], style: 'title' }, { cells: [], style: 'blank' }];
  for (const block of blocks) {
    switch (block.type) {
      case 'table':
        rows.push({ cells: block.header, style: 'header' });
        block.rows.forEach((row, i) => rows.push({ cells: row, style: i % 2 === 1 ? 'band' : 'cell' }));
        rows.push({ cells: [], style: 'blank' });
        break;
      case 'list':
        for (const item of block.items) rows.push({ cells: [inlineText(item)], style: 'text' });
        break;
      case 'heading':
        rows.push({ cells: [], style: 'blank' }, { cells: [inlineText(block.inlines)], style: 'section' });
        break;
      case 'code':
        for (const line of block.text.split('\n')) rows.push({ cells: [line], style: 'text' });
        break;
      default:
        rows.push({ cells: [inlineText(block.inlines)], style: 'text' });
    }
  }
  return { name: title, rows, frozen: false };
}

export function markdownContent(markdown: string, title: string): DocContent {
  let blocks = parseMarkdown(markdown);
  // guessTitle() usually lifts the answer's own first heading into the title, and every renderer
  // prints the title itself — so leaving that heading in place repeats it on the first line.
  const first = blocks[0];
  if (first?.type === 'heading' && inlineText(first.inlines).trim() === title.trim()) {
    blocks = blocks.slice(1);
  }
  return {
    title,
    blocks,
    slides: blocksToSlides(blocks, title),
    sheets: [blocksToSheet(blocks, title)],
  };
}

// Flattens a structured deliverable into the same Block[] the markdown path produces — which is
// also what the chat card renders as an inline preview, so what is on screen is what downloads.
export function deliverableBlocks(deliverable: ParsedDeliverable): Block[] {
  const blocks: Block[] = [];
  if (deliverable.kind === 'document') {
    for (const section of deliverable.sections) {
      if (section.heading) blocks.push({ type: 'heading', level: 1, inlines: parseInline(section.heading) });
      for (const p of section.paragraphs ?? []) blocks.push({ type: 'paragraph', inlines: parseInline(p) });
      const bullets = section.bullets ?? [];
      if (bullets.length > 0) blocks.push({ type: 'list', ordered: false, items: bullets.map(parseInline) });
    }
  } else if (deliverable.kind === 'presentation') {
    for (const slide of deliverable.slides) {
      blocks.push({ type: 'heading', level: 1, inlines: parseInline(slide.title) });
      const bullets = slide.bullets ?? [];
      if (bullets.length > 0) blocks.push({ type: 'list', ordered: false, items: bullets.map(parseInline) });
    }
  } else {
    for (const sheet of deliverable.sheets) {
      blocks.push({ type: 'heading', level: 1, inlines: parseInline(sheet.name) });
      blocks.push({ type: 'table', header: sheet.columns, rows: sheet.rows });
    }
  }
  return blocks;
}

export function deliverableContent(deliverable: ParsedDeliverable): DocContent {
  const blocks = deliverableBlocks(deliverable);
  const slides =
    deliverable.kind === 'presentation'
      ? deliverable.slides.map((s) => ({ title: s.title, bullets: s.bullets ?? [], notes: s.notes }))
      : blocksToSlides(blocks, deliverable.title);
  // A spreadsheet deliverable already is a grid: its columns become row 1 so the sheet opens as
  // a usable table with a frozen header, instead of being buried under a title row.
  const sheets =
    deliverable.kind === 'spreadsheet'
      ? deliverable.sheets.map((sheet) => ({
          name: sheet.name,
          frozen: sheet.columns.length > 0,
          rows: [
            ...(sheet.columns.length > 0 ? [{ cells: sheet.columns, style: 'header' as RowStyle }] : []),
            ...sheet.rows.map((row, i) => ({ cells: row, style: (i % 2 === 1 ? 'band' : 'cell') as RowStyle })),
          ],
        }))
      : [blocksToSheet(blocks, deliverable.title)];
  return { title: deliverable.title, blocks, slides, sheets };
}

// --- File names -------------------------------------------------------------------------------

export function exportFileName(title: string, format: ExportFormat): string {
  const safeTitle = title.replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safeTitle || 'ONEFLOW'}.${format}`;
}

export function suggestedFileName(deliverable: ParsedDeliverable, format?: ExportFormat): string {
  return exportFileName(deliverable.title, format ?? DEFAULT_FORMAT[deliverable.kind]);
}

// --- Shared styling ---------------------------------------------------------------------------
// ONEFLOW is a monochrome brand, so the files are too: near-black ink, one grey rule, one grey
// band. No invented accent colour, and everything still prints legibly.

const INK = '111114';
const BODY_INK = '2E2E33';
const MUTED_INK = '8A8A94';
const RULE = 'D8D8DE';
const HEADER_FILL = '15151A';
const BAND_FILL = 'F4F4F6';

// --- DOCX -------------------------------------------------------------------------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function inlinesToRuns(inlines: Inline[], extra: { bold?: boolean; color?: string } = {}): TextRun[] {
  return inlines.map(
    (part) =>
      new TextRun({
        text: part.text,
        bold: extra.bold || part.type === 'bold',
        italics: part.type === 'italic',
        font: part.type === 'code' ? 'Consolas' : undefined,
        color: extra.color,
      })
  );
}

// The page is A4 with 2cm margins, so the usable text column is ~9630 twips. Tables are laid out
// a little narrower: column widths must sum to the table width or Word re-flows them itself.
const TABLE_WIDTH_DXA = 9360;

function docxTable(block: Extract<Block, { type: 'table' }>): Table {
  const columns = Math.max(block.header.length, 1);
  const columnWidth = Math.floor(TABLE_WIDTH_DXA / columns);
  const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: RULE };

  const buildRow = (cells: string[], rowIndex: number) =>
    new TableRow({
      tableHeader: rowIndex === 0,
      children: Array.from({ length: columns }, (_, c) => cells[c] ?? '').map(
        (cell) =>
          new TableCell({
            width: { size: columnWidth, type: WidthType.DXA },
            margins: { top: 90, bottom: 90, left: 130, right: 130 },
            // ShadingType.CLEAR, never SOLID — SOLID renders as a black block in Word.
            shading:
              rowIndex === 0
                ? { type: ShadingType.CLEAR, fill: HEADER_FILL, color: 'auto' }
                : rowIndex % 2 === 0
                  ? { type: ShadingType.CLEAR, fill: BAND_FILL, color: 'auto' }
                  : undefined,
            children: [
              new Paragraph({
                spacing: { after: 0, line: 260 },
                children: inlinesToRuns(parseInline(cell), rowIndex === 0 ? { bold: true, color: 'FFFFFF' } : {}),
              }),
            ],
          })
      ),
    });

  return new Table({
    width: { size: TABLE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: Array.from({ length: columns }, () => columnWidth),
    borders: {
      top: thinBorder,
      bottom: thinBorder,
      left: thinBorder,
      right: thinBorder,
      insideHorizontal: thinBorder,
      insideVertical: thinBorder,
    },
    rows: [block.header, ...block.rows].map(buildRow),
  });
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
        block.items.forEach((item, i) =>
          children.push(
            new Paragraph({
              children: inlinesToRuns(item),
              spacing: { after: i === block.items.length - 1 ? 160 : 60 },
              ...(block.ordered ? { numbering: { reference: 'md-numbers', level: 0 } } : { bullet: { level: 0 } }),
            })
          )
        );
        break;
      case 'code':
        block.text.split('\n').forEach((line, i, all) =>
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line || ' ', font: 'Consolas', color: BODY_INK })],
              shading: { type: ShadingType.CLEAR, fill: BAND_FILL, color: 'auto' },
              spacing: { after: i === all.length - 1 ? 160 : 0, line: 260 },
            })
          )
        );
        break;
      case 'table':
        children.push(docxTable(block));
        // Word merges two tables that touch, and leaves no air under the last one.
        children.push(new Paragraph({ text: '', spacing: { after: 0 } }));
        break;
      default:
        children.push(new Paragraph({ children: inlinesToRuns(block.inlines) }));
    }
  }
  return children.length > 0 ? children : [new Paragraph({ text: '' })];
}

export async function renderDocx(content: DocContent): Promise<string> {
  const file = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: BODY_INK },
          paragraph: { spacing: { after: 160, line: 300 } },
        },
        title: {
          run: { font: 'Calibri', size: 52, bold: true, color: INK },
          paragraph: { spacing: { after: 60 } },
        },
        heading1: {
          run: { font: 'Calibri', size: 30, bold: true, color: INK },
          paragraph: { spacing: { before: 400, after: 140 } },
        },
        heading2: {
          run: { font: 'Calibri', size: 26, bold: true, color: INK },
          paragraph: { spacing: { before: 300, after: 120 } },
        },
        heading3: {
          run: { font: 'Calibri', size: 23, bold: true, color: BODY_INK },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        listParagraph: { paragraph: { spacing: { after: 60 } } },
      },
    },
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
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children: [
          new Paragraph({ text: content.title, heading: HeadingLevel.TITLE }),
          // Hairline under the title — a paragraph bottom border, not a one-row table.
          new Paragraph({
            text: '',
            spacing: { after: 320 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
          }),
          ...blocksToDocxChildren(content.blocks),
        ],
      },
    ],
  });
  return blobToDataUrl(await Packer.toBlob(file));
}

// --- PPTX -------------------------------------------------------------------------------------
// 16:9 (10 x 5.625in): a dark cover, then light content slides so the deck still prints.

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MAX_BULLETS_PER_SLIDE = 7;

export async function renderPptx(content: DocContent): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  const cover = pptx.addSlide();
  cover.background = { color: '0E0E11' };
  cover.addText('ONEFLOW', {
    x: 0.6,
    y: 0.5,
    w: 5,
    h: 0.3,
    fontSize: 11,
    bold: true,
    color: MUTED_INK,
    charSpacing: 3,
  });
  cover.addText(content.title, {
    x: 0.6,
    y: 1.9,
    w: 8.8,
    h: 1.7,
    fontSize: 38,
    bold: true,
    color: 'FFFFFF',
    valign: 'top',
  });
  cover.addShape(pptx.ShapeType.rect, { x: 0.62, y: 3.75, w: 1.2, h: 0.05, fill: { color: 'D4D4D8' } });

  // Long sections spill onto continuation slides rather than overflowing the text box.
  const pages: Slide[] = [];
  for (const slide of content.slides) {
    for (let i = 0; i < slide.bullets.length; i += MAX_BULLETS_PER_SLIDE) {
      pages.push({
        title: slide.title,
        bullets: slide.bullets.slice(i, i + MAX_BULLETS_PER_SLIDE),
        notes: i === 0 ? slide.notes : undefined,
      });
    }
  }

  pages.forEach((page, index) => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText(page.title, {
      x: 0.6,
      y: 0.45,
      w: 8.8,
      h: 0.7,
      fontSize: 23,
      bold: true,
      color: INK,
      valign: 'top',
    });
    s.addShape(pptx.ShapeType.rect, { x: 0.62, y: 1.22, w: 0.85, h: 0.04, fill: { color: INK } });
    s.addText(
      page.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
      {
        x: 0.6,
        y: 1.55,
        w: 8.8,
        h: 3.4,
        fontSize: 15,
        color: BODY_INK,
        lineSpacingMultiple: 1.25,
        valign: 'top',
      }
    );
    s.addText(content.title, { x: 0.6, y: SLIDE_H - 0.5, w: 6, h: 0.3, fontSize: 9, color: MUTED_INK });
    s.addText(String(index + 1), {
      x: SLIDE_W - 1.2,
      y: SLIDE_H - 0.5,
      w: 0.6,
      h: 0.3,
      fontSize: 9,
      color: MUTED_INK,
      align: 'right',
    });
    if (page.notes) s.addNotes(page.notes);
  });

  const base64 = (await pptx.write({ outputType: 'base64' })) as string;
  return `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64}`;
}

// --- XLSX -------------------------------------------------------------------------------------
// Written by hand rather than pulling in a spreadsheet library: an .xlsx is a zip of small XML
// parts, and JSZip is already in the bundle (pptxgenjs builds its .pptx with it). Strings go in
// as inline values, which skips the shared-string table entirely.

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control characters are illegal in XML 1.0 and Excel refuses the whole file over one.
      .replace(/[ --]/g, '')
  );
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

// Index into the cellXfs list in stylesXml() below.
const CELL_STYLE: Record<RowStyle, number> = {
  title: 1,
  section: 2,
  header: 3,
  cell: 4,
  band: 5,
  text: 6,
  blank: 0,
};

function stylesXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4">' +
    `<font><sz val="11"/><color rgb="FF${BODY_INK}"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="18"/><color rgb="FF${INK}"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="13"/><color rgb="FF${INK}"/><name val="Calibri"/></font>` +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${BAND_FILL}"/><bgColor indexed="64"/></patternFill></fill>` +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border>' +
    `<left style="thin"><color rgb="FF${RULE}"/></left>` +
    `<right style="thin"><color rgb="FF${RULE}"/></right>` +
    `<top style="thin"><color rgb="FF${RULE}"/></top>` +
    `<bottom style="thin"><color rgb="FF${RULE}"/></bottom>` +
    '<diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

// Plain integers and comma-decimals ("1,8") go in as numbers so Excel can sum and chart them.
// Dot-decimals are the ambiguous case: "01.10" and "20.11" are how a Russian schedule writes a
// date, and storing those as 1.1 / 20.11 silently destroys the value. Anything shaped like
// day.month stays text — a number kept as text is a green triangle, a date eaten is a wrong file.
const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;
const DAY_MONTH_RE = /^(0[1-9]|[12]\d|3[01]|[1-9])\.(0[1-9]|1[0-2])$/;

function isNumericCell(text: string): boolean {
  if (!NUMERIC_RE.test(text)) return false;
  if (text.includes(',')) return true;
  return !DAY_MONTH_RE.test(text) && !/^-?0\d/.test(text);
}

function cellXml(value: string, ref: string, styleIndex: number): string {
  const text = (value ?? '').trim();
  const style = styleIndex > 0 ? ` s="${styleIndex}"` : '';
  // An empty cell still has to be emitted when it carries a border, or the table has gaps.
  if (text === '') return styleIndex > 0 ? `<c r="${ref}"${style}/>` : '';
  if (isNumericCell(text)) return `<c r="${ref}"${style}><v>${text.replace(',', '.')}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

// Excel does not auto-fit on open, so the widths are measured from the content once, here.
function columnWidths(rows: SheetRow[]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, c) => {
      const longest = Math.max(0, ...String(cell ?? '').split('\n').map((line) => line.length));
      widths[c] = Math.max(widths[c] ?? 0, longest);
    });
  }
  return widths.map((w) => Math.min(Math.max(w + 3, 12), 60));
}

function sheetXml(sheet: SheetData): string {
  const widths = columnWidths(sheet.rows);
  const cols =
    widths.length > 0
      ? `<cols>${widths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
          .join('')}</cols>`
      : '';
  const pane = sheet.frozen
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : '';
  const body = sheet.rows
    .map((row, r) => {
      const rowNumber = r + 1;
      const style = CELL_STYLE[row.style];
      const cells = row.cells.map((value, c) => cellXml(value, `${columnName(c)}${rowNumber}`, style)).join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join('');
  // Element order inside <worksheet> is schema-enforced: sheetViews, sheetFormatPr, cols, sheetData.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

// Sheet names can't exceed 31 chars, contain []:*?/\, or repeat — Excel rejects the file outright.
function sheetNames(sheets: SheetData[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const base = (
      sheet.name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || `Sheet ${i + 1}`
    ).slice(0, 31);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export async function renderXlsx(content: DocContent): Promise<string> {
  const sheets = content.sheets.length > 0 ? content.sheets : [{ name: content.title, rows: [], frozen: false }];
  const names = sheetNames(sheets);
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '</Types>'
  );

  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  );

  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>'
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>'
  );

  zip.file('xl/styles.xml', stylesXml());
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows.length > 0 ? sheet.rows : [{ cells: [''], style: 'text' as RowStyle }];
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml({ ...sheet, rows }));
  });

  const base64 = await zip.generateAsync({ type: 'base64' });
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
}

// --- Entry points -------------------------------------------------------------------------------

export function renderContent(content: DocContent, format: ExportFormat): Promise<string> {
  if (format === 'docx') return renderDocx(content);
  if (format === 'xlsx') return renderXlsx(content);
  return renderPptx(content);
}

// Export any chat answer, not just the ones the model wrapped in an oneflow-document block.
export function buildExport(markdown: string, title: string, format: ExportFormat): Promise<string> {
  return renderContent(markdownContent(markdown, title), format);
}

// Download the document the model handed straight to the chat, in whichever format is asked for.
export function buildDeliverableExport(
  deliverable: ParsedDeliverable,
  format: ExportFormat = DEFAULT_FORMAT[deliverable.kind]
): Promise<string> {
  return renderContent(deliverableContent(deliverable), format);
}
