import type { ChatMessage } from '../types';
import type { ParsedDeliverable } from '../deliverables';
import { officeExtension, officeFileToMarkdown } from '../officeImport';
import { pdfFileToText } from '../pdfImport';
import { zipFileToText } from '../zipImport';

// Data model for the Copywrite engine redesign (see CLAUDE_COPYWRITE.md for the full spec this
// ports). Deliberately plain objects + localStorage instead of the IndexedDB workspace the
// reference implementation used — same persisted-history behavior, no new dependency.

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
// a PDF or a ZIP may be bigger: only the text read from it is kept and sent
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 30_000;

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];

export interface Attachment {
  id: string;
  name: string;
  kind: 'image' | 'document';
  // Data URL for an image; text for a document — verbatim for .txt/.md/.csv/.json, and the
  // markdown reading of the file for .docx/.xlsx/.pptx (see officeImport.ts). Possibly truncated.
  data: string;
  // Set on an Office upload so the UI can label it and the request can say what it came from.
  office?: '.docx' | '.xlsx' | '.pptx';
  // A PDF (its text layer) or a ZIP (its documents, one after another); see pdfImport/zipImport.
  format?: 'pdf' | 'zip';
  // The text was longer than MAX_TEXT_LENGTH: only its beginning is kept and sent.
  truncated?: boolean;
}

export interface CwMessage extends ChatMessage {
  id: string;
  attachments?: Attachment[];
  deliverable?: ParsedDeliverable;
  feedback?: 'up' | 'down';
  /** which Copywrite model wrote the reply (src/chatModels.ts); older replies have none */
  model?: string;
}

export interface Thread {
  id: string;
  projectId?: string;
  title: string;
  messages: CwMessage[];
  suggestions: string[];
  pinned: boolean;
  archived: boolean;
  updatedAt: number;
  draft: string;
  attachments: Attachment[];
}

export interface Project {
  id: string;
  name: string;
}

export interface Workspace {
  projects: Project[];
  threads: Thread[];
  activeId: string;
  sidebarCollapsed: boolean;
}

let counter = 0;
export function id(): string {
  counter += 1;
  return `cw-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newThread(title: string, projectId?: string): Thread {
  return {
    id: id(),
    projectId,
    title,
    messages: [],
    suggestions: [],
    pinned: false,
    archived: false,
    updatedAt: Date.now(),
    draft: '',
    attachments: [],
  };
}

export function newWorkspace(defaultTitle: string): Workspace {
  const thread = newThread(defaultTitle);
  return { projects: [], threads: [thread], activeId: thread.id, sidebarCollapsed: false };
}

// Deleting the last remaining thread always leaves a fresh empty one behind, same as picking a
// new active thread when the deleted one was selected.
export function removeThread(state: Workspace, threadId: string, defaultTitle: string): Workspace {
  const remaining = state.threads.filter((t) => t.id !== threadId);
  if (remaining.length === 0) {
    const fresh = newThread(defaultTitle);
    return { ...state, threads: [fresh], activeId: fresh.id };
  }
  const activeId = state.activeId === threadId ? remaining[0].id : state.activeId;
  return { ...state, threads: remaining, activeId };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function isAllowedTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function documentFormat(file: File): 'pdf' | 'zip' | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (lower.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') return 'zip';
  return null;
}

export function isAttachable(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type) || isAllowedTextFile(file.name) || officeExtension(file.name) !== null || documentFormat(file) !== null;
}

// Throws on an unsupported type or an oversized file — callers show the caller-facing
// fileError copy on catch, matching every other attachment surface in this app. 'unreadable'
// (from officeImport) is thrown separately because it needs its own advice, not "wrong format".
export async function readAttachment(file: File): Promise<Attachment> {
  const format = documentFormat(file);
  if (format) {
    if (file.size > MAX_DOCUMENT_FILE_BYTES) throw new Error('too-large');
    const { text, truncated } = format === 'pdf' ? await pdfFileToText(file, MAX_TEXT_LENGTH) : await zipFileToText(file, file.name, MAX_TEXT_LENGTH);
    return { id: id(), name: file.name, kind: 'document', data: text.slice(0, MAX_TEXT_LENGTH), format, truncated };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('too-large');
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    const data = await readFileAsDataUrl(file);
    return { id: id(), name: file.name, kind: 'image', data };
  }
  const office = officeExtension(file.name);
  if (office) {
    const markdown = await officeFileToMarkdown(file);
    return { id: id(), name: file.name, kind: 'document', data: markdown.slice(0, MAX_TEXT_LENGTH), office, truncated: markdown.length > MAX_TEXT_LENGTH };
  }
  if (isAllowedTextFile(file.name)) {
    const text = await readFileAsText(file);
    return { id: id(), name: file.name, kind: 'document', data: text.slice(0, MAX_TEXT_LENGTH), truncated: text.length > MAX_TEXT_LENGTH };
  }
  throw new Error('unsupported');
}

export function exportMarkdown(thread: Thread): string {
  const lines = [`# ${thread.title}`, ''];
  for (const m of thread.messages) {
    lines.push(m.role === 'user' ? '**User**' : '**ONEFLOW AI**');
    lines.push(m.content, '');
  }
  return lines.join('\n');
}
