import type { ChatMessage } from '../types';
import type { ParsedDeliverable } from '../deliverables';

// Data model for the Copywrite engine redesign (see CLAUDE_COPYWRITE.md for the full spec this
// ports). Deliberately plain objects + localStorage instead of the IndexedDB workspace the
// reference implementation used — same persisted-history behavior, no new dependency.

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 30_000;

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];

export interface Attachment {
  id: string;
  name: string;
  kind: 'image' | 'document';
  data: string; // data URL for an image, raw (possibly truncated) text for a document
}

export interface CwMessage extends ChatMessage {
  id: string;
  attachments?: Attachment[];
  deliverable?: ParsedDeliverable;
  feedback?: 'up' | 'down';
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

export function isAttachable(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type) || isAllowedTextFile(file.name);
}

// Throws on an unsupported type or an oversized file — callers show the caller-facing
// fileError copy on catch, matching every other attachment surface in this app.
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('too-large');
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
    const data = await readFileAsDataUrl(file);
    return { id: id(), name: file.name, kind: 'image', data };
  }
  if (isAllowedTextFile(file.name)) {
    const text = await readFileAsText(file);
    return { id: id(), name: file.name, kind: 'document', data: text.slice(0, MAX_TEXT_LENGTH) };
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
