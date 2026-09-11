// Minimal markdown reader shared by the chat's on-screen rendering (MarkdownText.tsx) and its
// Word/Excel/PowerPoint exports (deliverables.ts) — one parse, several consumers, so text the
// user sees bold on screen is bold in the downloaded file too.
//
// Deliberately not a CommonMark implementation: it covers what the chat model actually emits —
// headings, bold/italic/code spans, bullet and numbered lists, fenced code, pipe tables — and
// treats everything else as plain paragraph text rather than guessing.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string };

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] };

// `_underscore_` italics are left out on purpose — they fire inside snake_case identifiers and
// file names, which show up often enough in this chat to make the false positives worse than the
// missing feature. `__bold__` is safe since doubled underscores don't occur mid-word.
const INLINE_TOKEN = /(\*\*[\s\S]+?\*\*|__[\s\S]+?__|`[^`\n]+`|\*[^*\n]+?\*)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ type: 'text', text: text.slice(last, at) });
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      out.push({ type: 'bold', text: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) });
    } else {
      out.push({ type: 'italic', text: token.slice(1, -1) });
    }
    last = at + token.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.length > 0 ? out : [{ type: 'text', text }];
}

export function inlineText(inlines: Inline[]): string {
  return inlines.map((part) => part.text).join('');
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NUMBER_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*```/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

// The |---|---| line under a table's header row.
function isTableDivider(line: string): boolean {
  return line.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      i--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, inlines: parseInline(heading[2].trim()) });
      continue;
    }

    const ordered = NUMBER_RE.test(line);
    if (ordered || BULLET_RE.test(line)) {
      flushParagraph();
      const items: Inline[][] = [];
      while (i < lines.length) {
        const item = (ordered ? NUMBER_RE : BULLET_RE).exec(lines[i]);
        if (!item) break;
        items.push(parseInline(item[1].trim()));
        i++;
      }
      i--;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

// First heading, else first paragraph, trimmed to something usable as a file name.
export function guessTitle(blocks: Block[], fallback: string): string {
  const heading = blocks.find((b) => b.type === 'heading');
  if (heading && heading.type === 'heading') return inlineText(heading.inlines).slice(0, 80);
  const paragraph = blocks.find((b) => b.type === 'paragraph');
  if (paragraph && paragraph.type === 'paragraph') return inlineText(paragraph.inlines).slice(0, 60);
  return fallback;
}
