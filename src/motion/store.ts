// Motion Engine persistence: materials (as Blobs) and every storyboard variant stay in this
// browser's IndexedDB, per account, so the history survives reloads and the user can come back
// and render any earlier variant. Nothing here is uploaded anywhere.
import type { MotionAsset, MotionVariant } from './types';

export interface MotionState {
  brief: string;
  duration: number;
  aspect: string;
  quality: string;
  fps: number;
  assets: MotionAsset[]; // every asset still in use — materials plus anything an older variant uses
  materialIds: string[]; // what goes into the next storyboard
  variants: MotionVariant[];
  selectedId: string | null;
}

const DB = 'oneflow-motion';
const STORE = 'state';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadMotionState(account: string): Promise<MotionState | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(account);
      req.onsuccess = () => resolve((req.result as MotionState) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveMotionState(account: string, state: MotionState): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, account);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // private mode / storage full — the session still works, it just won't survive a reload
  }
}
