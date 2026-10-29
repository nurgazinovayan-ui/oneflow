// PDF → plain text for Copywrite attachments, read in the browser with pdf.js (pdfjs-dist). The
// library and its worker load only when a PDF is attached (the worker's address below is just a
// string). Only the text layer is read: a scanned PDF (pictures of pages) has none and is reported
// as such instead of being sent empty.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface PdfText {
  text: string;
  pages: number;
  /** the text was longer than maxChars and was cut */
  truncated: boolean;
}

// Thrown with these messages so the caller can give the right advice.
export const PDF_NO_TEXT = 'pdf-no-text';
export const PDF_PASSWORD = 'pdf-password';

export async function pdfFileToText(file: Blob, maxChars: number): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, enableXfa: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    throw new Error(err instanceof pdfjs.PasswordException ? PDF_PASSWORD : 'unreadable');
  }
  try {
    const parts: string[] = [];
    let length = 0;
    let truncated = false;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      page.cleanup();
      if (!pageText) continue;
      const part = `[Страница ${n}]\n${pageText}`;
      if (length + part.length > maxChars) {
        parts.push(part.slice(0, Math.max(0, maxChars - length)));
        truncated = true;
        break;
      }
      parts.push(part);
      length += part.length + 2;
    }
    const text = parts.join('\n\n').trim();
    if (!text) throw new Error(PDF_NO_TEXT);
    return { text, pages: doc.numPages, truncated };
  } finally {
    // the loading task owns the worker and the document
    void task.destroy();
  }
}
