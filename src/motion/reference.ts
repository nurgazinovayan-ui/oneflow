// Motion Engine reference: the user uploads a video (or a few images) the result should look like.
// Everything here runs in the browser: cuts are found by comparing tiny grayscale samples frame to
// frame, each shot gets a motion level from how much it changes, the palette comes from a colour
// histogram of the keyframes, and one keyframe per shot is sent to the model. The reference itself
// never goes into the video — only this summary does.
import type { MotionSource } from './render';
import type { MotionReferenceInfo, MotionReferenceShot } from './types';

const SAMPLE_FPS = 5;
const MAX_SECONDS = 60;
const MAX_SHOTS = 20;
const MAX_FRAMES = 12;
const MIN_SHOT = 0.35;
const SW = 48;
const SH = 27;

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 3000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function gray(ctx: CanvasRenderingContext2D, el: CanvasImageSource): Float32Array {
  ctx.drawImage(el, 0, 0, SW, SH);
  const d = ctx.getImageData(0, 0, SW, SH).data;
  const out = new Float32Array(SW * SH);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  return out;
}

function diff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function jpeg(el: CanvasImageSource, w: number, h: number, max = 512): string {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}

// Dominant colours: 4-bit-per-channel histogram over small copies of the keyframes, most common
// buckets first, near-duplicates dropped.
function palette(sources: { el: CanvasImageSource }[]): string[] {
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const s of sources) {
    ctx.drawImage(s.el, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += d[i];
      e.g += d[i + 1];
      e.b += d[i + 2];
      buckets.set(key, e);
    }
  }
  const out: [number, number, number][] = [];
  for (const e of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const rgb: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (out.every((o) => Math.hypot(o[0] - rgb[0], o[1] - rgb[1], o[2] - rgb[2]) > 48)) out.push(rgb);
    if (out.length === 6) break;
  }
  return out.map((rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
}

// A video reference: shots (cuts), their rhythm and motion, palette, one keyframe per shot.
export async function analyzeVideoReference(src: MotionSource, onProgress?: (p: number) => void): Promise<MotionReferenceInfo> {
  const v = src.video!;
  const duration = Math.min(MAX_SECONDS, Number.isFinite(v.duration) ? v.duration : 0);
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const n = Math.max(2, Math.floor(duration * SAMPLE_FPS));
  const diffs: number[] = [];
  let prev: Float32Array | null = null;
  for (let i = 0; i < n; i++) {
    await seek(v, Math.min(duration - 0.05, i / SAMPLE_FPS));
    const g = gray(ctx, v);
    diffs.push(prev ? diff(prev, g) : 0);
    prev = g;
    if (i % 5 === 0) onProgress?.((i / n) * 0.8);
  }
  // cut = a local spike: above this video's own normal change AND well above its neighbourhood, so
  // soft screen-to-screen edits count while a fast camera move (high but even change) doesn't
  const body = diffs.slice(1);
  const mean = body.reduce((a, b) => a + b, 0) / Math.max(1, body.length);
  const sd = Math.sqrt(body.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, body.length));
  const threshold = Math.max(0.008, mean + 1.5 * sd);
  const cuts = [0];
  for (let i = 1; i < diffs.length; i++) {
    const t = i / SAMPLE_FPS;
    const d = diffs[i];
    const around: number[] = [];
    for (let j = i - 5; j <= i + 5; j++) if (j > 0 && j < diffs.length && Math.abs(j - i) > 1) around.push(diffs[j]);
    around.sort((a, b) => a - b);
    const median = around[Math.floor(around.length / 2)] ?? 0;
    const peak = d >= diffs[i - 1] && d >= (diffs[i + 1] ?? 0);
    if (peak && d > threshold && d > 3 * median + 0.004 && t - cuts[cuts.length - 1] >= MIN_SHOT) cuts.push(t);
  }
  let shots: MotionReferenceShot[] = cuts.map((start, k) => {
    const end = k + 1 < cuts.length ? cuts[k + 1] : duration;
    const a = Math.round(start * SAMPLE_FPS) + 1;
    const b = Math.max(a, Math.round(end * SAMPLE_FPS) - 1);
    const inner = diffs.slice(a, b);
    const motion = inner.length ? inner.reduce((x, y) => x + y, 0) / inner.length : 0;
    return { start: Math.round(start * 100) / 100, dur: Math.round((end - start) * 100) / 100, motion: Math.round(motion * 1000) / 1000 };
  });
  // too many shots for the engine → merge the shortest into their neighbour
  while (shots.length > MAX_SHOTS) {
    let k = 0;
    shots.forEach((s, i) => (s.dur < shots[k].dur ? (k = i) : null));
    const j = k === 0 ? 1 : k - 1;
    const a = shots[Math.min(j, k)];
    const b = shots[Math.max(j, k)];
    const merged = { start: a.start, dur: Math.round((a.dur + b.dur) * 100) / 100, motion: Math.round(((a.motion * a.dur + b.motion * b.dur) / (a.dur + b.dur)) * 1000) / 1000 };
    shots = [...shots.slice(0, Math.min(j, k)), merged, ...shots.slice(Math.max(j, k) + 1)];
  }
  // keyframes: the middle of each shot (evenly thinned to MAX_FRAMES)
  const pick = shots.length <= MAX_FRAMES ? shots.map((_, i) => i) : Array.from({ length: MAX_FRAMES }, (_, i) => Math.round((i * (shots.length - 1)) / (MAX_FRAMES - 1)));
  const frames: string[] = [];
  const frameShots: number[] = [];
  const snaps: { el: CanvasImageSource }[] = [];
  for (const i of pick) {
    const s = shots[i];
    await seek(v, Math.min(duration - 0.05, s.start + s.dur / 2));
    frames.push(jpeg(v, src.width, src.height));
    frameShots.push(i);
    const snap = document.createElement('canvas');
    snap.width = 160;
    snap.height = Math.round((160 * src.height) / Math.max(1, src.width));
    snap.getContext('2d')!.drawImage(v, 0, 0, snap.width, snap.height);
    snaps.push({ el: snap });
    onProgress?.(0.8 + (0.2 * frames.length) / pick.length);
  }
  return { kind: 'video', duration: Math.round(duration * 100) / 100, width: src.width, height: src.height, shots, palette: palette(snaps), frames, frameShots };
}

// Image references: no rhythm, just the look.
export function analyzeImageReference(sources: MotionSource[]): MotionReferenceInfo {
  const list = sources.slice(0, 4);
  return {
    kind: 'images',
    duration: 0,
    width: list[0]?.width ?? 0,
    height: list[0]?.height ?? 0,
    shots: [],
    palette: palette(list),
    frames: list.map((s) => jpeg(s.el, s.width, s.height)),
    frameShots: [],
  };
}

// 0…1 frame-difference → the pace words the UI and the prompt use.
export const motionLevel = (m: number): 'calm' | 'medium' | 'fast' => (m < 0.02 ? 'calm' : m < 0.05 ? 'medium' : 'fast');
