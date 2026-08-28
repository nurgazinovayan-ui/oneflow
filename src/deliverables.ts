// Parses the optional ```oneflow-document fenced JSON block the Работа с текстом chat can
// emit (see TEXT_CHAT_SYSTEM_PROMPT in electron/main.ts / supabase/functions/generate-chat)
// and turns it into an actual downloadable .docx or .pptx file, built entirely client-side —
// the model only ever returns structured text content, never binary output.

import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import PptxGenJS from 'pptxgenjs';

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
