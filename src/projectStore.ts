// Autosave for canvas projects, backed by IndexedDB.
//
// Deliberately not localStorage, which the rest of the app uses for small preferences: a project
// carries node data that can include base64 photos (an imageInput node holds the user's own
// picture inline) and a handful of those passes localStorage's ~5 MB quota, which fails by
// throwing on write — i.e. it would silently stop saving exactly on the biggest projects.
// IndexedDB stores structured clones with no such cliff and doesn't block the canvas while it
// writes.
//
// Everything here fails soft: losing autosave is annoying, but it must never take the canvas
// down with it (private-mode browsers can refuse to open a database at all).

import type { Edge, Node } from '@xyflow/react';
import type { ChatMessage } from './types';

const DB_NAME = 'oneflow-projects';
const DB_VERSION = 1;
const STORE = 'projects';

// The start screen lists recent work, not an archive — past this it's scrolling, not choosing.
const MAX_RECENT = 12;

export interface StoredProject {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  assistantMessages: ChatMessage[];
  assistantDraft: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Firefox in private mode leaves the request pending rather than erroring.
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let request: IDBRequest<T> | null = null;
        try {
          const tx = db.transaction(STORE, mode);
          request = run(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request ? request.result : null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

// A project with no nodes isn't work worth offering to reopen — and every launch creates one
// blank project, so keeping them would fill the list with empties. Clearing a canvas therefore
// drops it from the list, which matches what autosave means: the stored copy is the live one.
function hasContent(project: { nodes: Node[] }): boolean {
  return project.nodes.length > 0;
}

export async function loadRecentProjects(): Promise<StoredProject[]> {
  const all = await runTransaction<StoredProject[]>('readonly', (store) => store.getAll());
  if (!all) return [];
  return all
    .filter(hasContent)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_RECENT);
}

export async function loadProject(id: string): Promise<StoredProject | null> {
  return (await runTransaction<StoredProject>('readonly', (store) => store.get(id))) ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id) as unknown as IDBRequest<never>);
}

export interface SaveResult {
  ok: boolean;
  // True when the browser refused the write for lack of space, which is worth telling the user
  // about — every other failure here is either transient or means autosave is simply off.
  quotaExceeded: boolean;
}

// Writes the whole open set in one transaction, so a save never leaves half the tabs at one
// point in time and half at another.
export function saveProjects(projects: Omit<StoredProject, 'updatedAt'>[]): Promise<SaveResult> {
  const updatedAt = Date.now();
  return openDb().then(
    (db) =>
      new Promise<SaveResult>((resolve) => {
        if (!db) {
          resolve({ ok: false, quotaExceeded: false });
          return;
        }
        try {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          for (const project of projects) {
            if (hasContent(project as { nodes: Node[] })) store.put({ ...project, updatedAt });
            else store.delete(project.id);
          }
          tx.oncomplete = () => resolve({ ok: true, quotaExceeded: false });
          tx.onabort = () =>
            resolve({ ok: false, quotaExceeded: tx.error?.name === 'QuotaExceededError' });
          tx.onerror = () =>
            resolve({ ok: false, quotaExceeded: tx.error?.name === 'QuotaExceededError' });
        } catch {
          resolve({ ok: false, quotaExceeded: false });
        }
      })
  );
}
