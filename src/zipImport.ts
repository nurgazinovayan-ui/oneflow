// A .zip attached to Copywrite, read in the browser: its documents (text, Office, PDF) become one
// document for the model, each under its path; pictures and everything else are listed by name.
// Bounded so a hostile archive can't hang the tab: how many files are read, how big each may be
// unpacked and how much is unpacked in total.
import JSZip from 'jszip';
import { officeExtension, officeFileToMarkdown } from './officeImport';
import { pdfFileToText } from './pdfImport';

const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];
const MAX_FILES_READ = 50;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_LISTED = 30;

export const ZIP_EMPTY = 'zip-empty';

export interface ZipText {
  text: string;
  /** documents read from the archive */
  files: number;
  /** the text was longer than maxChars and was cut */
  truncated: boolean;
}

const isDocument = (name: string) => {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || officeExtension(lower) !== null || lower.endsWith('.pdf');
};

// JSZip keeps the unpacked size from the archive's directory on a private field; best effort.
const unpackedSize = (entry: JSZip.JSZipObject): number | null =>
  (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? null;

async function entryText(entry: JSZip.JSZipObject, budget: number): Promise<string> {
  const name = entry.name.split('/').pop() ?? entry.name;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return (await pdfFileToText(await entry.async('blob'), budget)).text;
  if (officeExtension(lower)) return officeFileToMarkdown(new File([await entry.async('blob')], name));
  return entry.async('string');
}

export async function zipFileToText(file: Blob, archiveName: string, maxChars: number): Promise<ZipText> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error('unreadable');
  }
  const entries: JSZip.JSZipObject[] = [];
  zip.forEach((path, entry) => {
    // folders, macOS resource forks and hidden files carry nothing for the model
    if (!entry.dir && !path.startsWith('__MACOSX/') && !path.split('/').some((p) => p.startsWith('.'))) entries.push(entry);
  });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const sections: string[] = [];
  const skipped: string[] = [];
  let length = 0;
  let unpacked = 0;
  let truncated = false;
  for (const entry of entries) {
    const size = unpackedSize(entry);
    if (!isDocument(entry.name) || sections.length >= MAX_FILES_READ || (size !== null && (size > MAX_ENTRY_BYTES || unpacked + size > MAX_TOTAL_BYTES))) {
      skipped.push(entry.name);
      continue;
    }
    if (truncated) continue;
    unpacked += size ?? 0;
    let body: string;
    try {
      body = (await entryText(entry, maxChars - length)).trim();
    } catch {
      skipped.push(entry.name);
      continue;
    }
    if (!body) continue;
    let section = `=== ${entry.name} ===\n${body}`;
    if (length + section.length > maxChars) {
      section = section.slice(0, Math.max(0, maxChars - length));
      truncated = true;
    }
    sections.push(section);
    length += section.length + 2;
  }
  if (sections.length === 0) throw new Error(ZIP_EMPTY);
  const head = `Архив ${archiveName}: прочитано файлов — ${sections.length}.`;
  const tail = skipped.length
    ? `\n\nНе прочитаны (другой формат или слишком большие): ${skipped.slice(0, MAX_LISTED).join(', ')}${skipped.length > MAX_LISTED ? ` и ещё ${skipped.length - MAX_LISTED}` : ''}.`
    : '';
  return { text: `${head}\n\n${sections.join('\n\n')}${tail}`, files: sections.length, truncated };
}
