// Motion Engine sandbox: runs the animation code Claude Opus wrote (src/motion/sandbox-runtime.js)
// where it can do no harm, and turns it into pictures.
// - An iframe with sandbox="allow-scripts" and no allow-same-origin: an opaque origin, so the code
//   cannot read the app's storage, cookies or session, nor touch this page.
// - Its CSP allows no network at all (default-src 'none'): nothing can be fetched or sent.
// - Inside it, the code runs in a worker where the browser allows one, so an endless loop cannot
//   freeze the app; every request has a deadline and a sandbox that misses it is torn down.
// Fonts and pictures are handed in as bytes / ImageBitmaps; frames come back as ImageBitmaps.
import RUNTIME from './sandbox-runtime.js?raw';
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interCyrillic from '@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2?url';
import geistLatin from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import geistCyrillic from '@fontsource-variable/geist/files/geist-cyrillic-wght-normal.woff2?url';
import unboundedLatin from '@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2?url';
import unboundedCyrillic from '@fontsource-variable/unbounded/files/unbounded-cyrillic-wght-normal.woff2?url';
import playfairLatin from '@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url';
import playfairCyrillic from '@fontsource-variable/playfair-display/files/playfair-display-cyrillic-wght-normal.woff2?url';
import monoLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import monoCyrillic from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2?url';

export interface SandboxAsset {
  kind: 'image' | 'video' | 'audio';
  name: string;
  width: number;
  height: number;
  image?: ImageBitmap; // photos: the picture itself; videos get their frames per request
}

export interface SandboxOptions {
  code: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  assets: SandboxAsset[];
  background?: string;
}

export interface MotionSandbox {
  // One frame at time t; `videos` are the current frames of video materials (by asset index).
  frame(t: number, videos?: Map<number, ImageBitmap>): Promise<ImageBitmap>;
  destroy(): void;
}

export type SandboxFailure = 'compile' | 'runtime' | 'timeout' | 'unsupported';

export class MotionSandboxError extends Error {
  constructor(message: string, readonly kind: SandboxFailure, readonly line?: number, readonly t?: number) {
    super(message);
  }
}

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const FONT_FILES: { family: string; url: string; unicodeRange: string }[] = [
  { family: 'Inter M', url: interLatin, unicodeRange: LATIN },
  { family: 'Inter M', url: interCyrillic, unicodeRange: CYRILLIC },
  { family: 'Geist M', url: geistLatin, unicodeRange: LATIN },
  { family: 'Geist M', url: geistCyrillic, unicodeRange: CYRILLIC },
  { family: 'Unbounded M', url: unboundedLatin, unicodeRange: LATIN },
  { family: 'Unbounded M', url: unboundedCyrillic, unicodeRange: CYRILLIC },
  { family: 'Playfair M', url: playfairLatin, unicodeRange: LATIN },
  { family: 'Playfair M', url: playfairCyrillic, unicodeRange: CYRILLIC },
  { family: 'JetBrains M', url: monoLatin, unicodeRange: LATIN },
  { family: 'JetBrains M', url: monoCyrillic, unicodeRange: CYRILLIC },
];

let fontBytes: Promise<{ family: string; data: ArrayBuffer; unicodeRange: string }[]> | null = null;
function loadFonts() {
  fontBytes ??= Promise.all(
    FONT_FILES.map(async (f) => {
      try {
        const res = await fetch(f.url);
        return res.ok ? { family: f.family, data: await res.arrayBuffer(), unicodeRange: f.unicodeRange } : null;
      } catch {
        return null;
      }
    })
  ).then((list) => list.filter((f): f is { family: string; data: ArrayBuffer; unicodeRange: string } => f !== null));
  return fontBytes;
}

const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; img-src blob: data:; font-src blob: data:";

// The page inside the iframe: starts the runtime in a worker (or, where a sandboxed page may not
// have one, on its own thread) and relays messages both ways.
function sandboxDocument(): string {
  const src = JSON.stringify(RUNTIME).replace(/<\//g, '<\\/');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body><script>
(function () {
  var SRC = ${src};
  var up = function (m, tr) { parent.postMessage(m, '*', tr || []); };
  var transfers = function (m) {
    var out = [];
    if (!m || typeof m !== 'object') return out;
    if (m.bitmap) out.push(m.bitmap);
    if (m.videos) for (var k in m.videos) out.push(m.videos[k]);
    if (m.assets) m.assets.forEach(function (a) { if (a.image) out.push(a.image); });
    if (m.fonts) m.fonts.forEach(function (f) { if (f.data) out.push(f.data); });
    return out;
  };
  var inPage = function () {
    (0, eval)(SRC);
    motionRuntime(up, function (fn) { window.addEventListener('message', function (e) { if (e.source === parent) fn(e.data); }); });
    up({ type: 'boot', worker: false });
  };
  var worker = null;
  try {
    var url = URL.createObjectURL(new Blob([SRC + '\\nmotionRuntime(function (m, tr) { self.postMessage(m, tr || []); }, function (fn) { self.onmessage = function (e) { fn(e.data); }; });'], { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch (e) {
    worker = null;
  }
  if (!worker) { inPage(); return; }
  var alive = false;
  var fallback = setTimeout(function () { if (!alive) { worker.terminate(); inPage(); } }, 2500);
  worker.onerror = function (e) {
    if (alive) { up({ type: 'error', stage: 'worker', message: String((e && e.message) || 'worker error') }); return; }
    clearTimeout(fallback); worker.terminate(); inPage();
  };
  worker.onmessage = function (e) {
    if (!alive && e.data && e.data.type === 'pong') { alive = true; clearTimeout(fallback); up({ type: 'boot', worker: true }); return; }
    up(e.data, transfers(e.data));
  };
  window.addEventListener('message', function (e) { if (e.source === parent && worker) worker.postMessage(e.data, transfers(e.data)); });
  worker.postMessage({ type: 'ping' });
})();
</script></body></html>`;
}

const wait = <T,>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new MotionSandboxError('Анимация считается слишком долго — похоже, код завис.', 'timeout'));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });

export async function createSandbox(o: SandboxOptions): Promise<MotionSandbox> {
  if (typeof createImageBitmap === 'undefined') throw new MotionSandboxError('Этот браузер не умеет собирать анимацию. Откройте ONEFLOW в свежем Chrome, Edge или Safari 17+.', 'unsupported');
  const fonts = await loadFonts();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: '16px', height: '16px', opacity: '0', pointerEvents: 'none', border: '0' });

  type Waiter = { resolve: (m: any) => void; reject: (e: Error) => void };
  let bootWaiter: Waiter | null = null;
  let readyWaiter: Waiter | null = null;
  const frames = new Map<number, Waiter>();
  let destroyed = false;

  const fail = (e: Error) => {
    bootWaiter?.reject(e);
    readyWaiter?.reject(e);
    frames.forEach((w) => w.reject(e));
    frames.clear();
  };
  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'boot') bootWaiter?.resolve(m);
    else if (m.type === 'ready') readyWaiter?.resolve(m);
    else if (m.type === 'frame' && typeof m.id === 'number' && m.bitmap instanceof ImageBitmap) {
      const w = frames.get(m.id);
      frames.delete(m.id);
      if (w) w.resolve(m.bitmap);
      else m.bitmap.close();
    } else if (m.type === 'error') {
      const err = new MotionSandboxError(String(m.message || 'Ошибка в анимации'), m.stage === 'compile' ? 'compile' : 'runtime', typeof m.line === 'number' ? m.line : undefined, typeof m.t === 'number' ? m.t : undefined);
      if (typeof m.id === 'number' && frames.has(m.id)) {
        frames.get(m.id)!.reject(err);
        frames.delete(m.id);
      } else if (readyWaiter) readyWaiter.reject(err);
      else fail(err);
    }
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('message', onMessage);
    iframe.remove(); // ends the worker too
    fail(new MotionSandboxError('Песочница закрыта.', 'runtime'));
  };
  window.addEventListener('message', onMessage);

  const booted = new Promise<{ worker: boolean }>((resolve, reject) => (bootWaiter = { resolve, reject }));
  iframe.srcdoc = sandboxDocument();
  document.body.appendChild(iframe);
  try {
    await wait(booted, 10_000, destroy);
    bootWaiter = null;
    const ready = new Promise((resolve, reject) => (readyWaiter = { resolve, reject }));
    const assets = o.assets.map((a) => ({ kind: a.kind, name: a.name, width: a.width, height: a.height, image: a.image }));
    const fontCopies = fonts.map((f) => ({ family: f.family, unicodeRange: f.unicodeRange, data: f.data.slice(0) }));
    const transfer: Transferable[] = [...assets.flatMap((a) => (a.image ? [a.image] : [])), ...fontCopies.map((f) => f.data)];
    iframe.contentWindow!.postMessage(
      { type: 'init', code: o.code, W: o.width, H: o.height, duration: o.duration, fps: o.fps, background: o.background, assets, fonts: fontCopies },
      '*',
      transfer
    );
    await wait(ready, 15_000, destroy);
    readyWaiter = null;
  } catch (e) {
    destroy();
    throw e;
  }

  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let first = true;
  const frame = (t: number, videos?: Map<number, ImageBitmap>): Promise<ImageBitmap> => {
    const run = async () => {
      if (destroyed) throw new MotionSandboxError('Песочница закрыта.', 'runtime');
      const id = ++seq;
      const got = new Promise<ImageBitmap>((resolve, reject) => frames.set(id, { resolve, reject }));
      const vids: Record<number, ImageBitmap> = {};
      videos?.forEach((b, i) => (vids[i] = b));
      iframe.contentWindow!.postMessage({ type: 'frame', id, t, videos: vids }, '*', Object.values(vids));
      // the first frame may warm up caches; after that a frame is a few milliseconds of drawing
      const bitmap = await wait(got, first ? 12_000 : 6_000, destroy);
      first = false;
      return bitmap;
    };
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };
  return { frame, destroy };
}
