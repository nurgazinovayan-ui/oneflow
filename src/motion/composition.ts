// Motion Engine: Opus's own animation (MotionComposition) → pictures and video.
// - checkComposition: runs the code once at a small size on a few moments of the video; an error,
//   a frame that never comes back or a video of blank frames is reported (the panel then sends it
//   back to Opus to fix), and the good frames become the card's posters.
// - renderComposition: every frame at the export size → src/motion/export.ts encodeFrames → MP4.
// - startPlayer: the live preview in the variant drawer.
// Video materials: the sandbox gets the frame of each video for the moment it draws, by meta.clips.
import { encodeFrames, type RenderResult } from './export';
import { createSandbox, MotionSandboxError, type MotionSandbox, type SandboxAsset } from './sandbox';
import type { MotionSources } from './render';
import type { MotionComposition } from './types';

// Where in its own video a material is at time t of the clip: inside a clip it plays from `from`;
// between clips it holds the nearest clip's edge frame; a video with no clips plays from the start.
export function clipTime(comp: MotionComposition, asset: number, t: number, videoDuration: number): number {
  const d = Number.isFinite(videoDuration) && videoDuration > 0.1 ? videoDuration : 0;
  const wrap = (x: number) => (d > 0.2 ? ((x % (d - 0.05)) + (d - 0.05)) % (d - 0.05) : 0);
  const clips = comp.clips.filter((c) => c.asset === asset);
  if (!clips.length) return wrap(t);
  const inside = clips.find((c) => t >= c.start && t < c.end);
  if (inside) return wrap(inside.from + (t - inside.start));
  // nearest edge
  let best = clips[0];
  let bestGap = Infinity;
  let atEnd = false;
  for (const c of clips) {
    const gapStart = Math.abs(t - c.start);
    const gapEnd = Math.abs(t - c.end);
    if (gapStart < bestGap) [best, bestGap, atEnd] = [c, gapStart, false];
    if (gapEnd < bestGap) [best, bestGap, atEnd] = [c, gapEnd, true];
  }
  return wrap(atEnd ? best.from + (best.end - best.start) - 0.04 : best.from);
}

function seek(v: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - time) < 0.01 && v.readyState >= 2) {
      resolve();
      return;
    }
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2500);
    v.addEventListener('seeked', done);
    v.currentTime = time;
  });
}

// A picture as an ImageBitmap no larger than maxSide (photos from a phone are often 4000+ px).
async function bitmapOf(el: CanvasImageSource, w: number, h: number, maxSide: number): Promise<ImageBitmap> {
  const k = Math.min(1, maxSide / Math.max(w, h, 1));
  if (k >= 1 && !(el instanceof HTMLVideoElement)) return createImageBitmap(el);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
  return createImageBitmap(c);
}

async function sandboxAssets(sources: MotionSources, names: string[], maxSide: number): Promise<SandboxAsset[]> {
  return Promise.all(
    sources.map(async (s, i) => {
      if (!s) return { kind: 'image' as const, name: names[i] ?? '', width: 1, height: 1 };
      if (s.video) return { kind: 'video' as const, name: names[i] ?? '', width: s.width, height: s.height };
      return { kind: 'image' as const, name: names[i] ?? '', width: s.width, height: s.height, image: await bitmapOf(s.el, s.width, s.height, maxSide) };
    })
  );
}

// Frames of the video materials for a moment, frame-exact (export, check): each video is seeked.
// A video whose frame would not change since the last call is not sent again.
class ExactVideos {
  private last = new Map<number, number>();
  constructor(private comp: MotionComposition, private sources: MotionSources, private maxSide: number, private fps: number) {}
  async at(t: number): Promise<Map<number, ImageBitmap>> {
    const out = new Map<number, ImageBitmap>();
    for (let i = 0; i < this.sources.length; i++) {
      const v = this.sources[i]?.video;
      if (!v) continue;
      const time = clipTime(this.comp, i, t, v.duration);
      const prev = this.last.get(i);
      if (prev !== undefined && Math.abs(prev - time) < 0.5 / this.fps) continue;
      await seek(v, time);
      out.set(i, await bitmapOf(v, v.videoWidth || this.sources[i]!.width, v.videoHeight || this.sources[i]!.height, this.maxSide));
      this.last.set(i, time);
    }
    return out;
  }
}

// Frames of the video materials while previewing in real time: the videos play, and are only
// nudged when they drift from where the clip says they should be.
class LiveVideos {
  constructor(private comp: MotionComposition, private sources: MotionSources, private maxSide: number) {}
  async at(t: number, playing: boolean): Promise<Map<number, ImageBitmap>> {
    const out = new Map<number, ImageBitmap>();
    for (let i = 0; i < this.sources.length; i++) {
      const v = this.sources[i]?.video;
      if (!v) continue;
      const time = clipTime(this.comp, i, t, v.duration);
      if (!playing) await seek(v, time);
      else {
        if (Math.abs(v.currentTime - time) > 0.3) v.currentTime = time;
        if (v.paused) void v.play().catch(() => undefined);
      }
      if (v.readyState >= 2) out.set(i, await bitmapOf(v, v.videoWidth, v.videoHeight, this.maxSide));
    }
    return out;
  }
  pause() {
    for (const s of this.sources) s?.video?.pause();
  }
}

export const describeError = (e: unknown): string => {
  if (e instanceof MotionSandboxError) {
    const where = [e.line ? `строка ${e.line}` : '', e.t !== undefined ? `t = ${e.t.toFixed(2)} с` : ''].filter(Boolean).join(', ');
    return where ? `${e.message} (${where})` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
};

// How much a frame varies: ~0 for a frame of one flat colour.
function variety(bitmap: ImageBitmap): number {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, 12, 12);
  const d = g.getImageData(0, 0, 12, 12).data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    min = Math.min(min, l);
    max = Math.max(max, l);
  }
  return max - min;
}

function poster(bitmap: ImageBitmap, long = 360): string {
  const k = long / Math.max(bitmap.width, bitmap.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}

export type CheckResult = { ok: true; posters: string[] } | { ok: false; error: string };

// Runs the code on 7 moments of the video at a small size. Posters: three of them (15 %, 50 %, 85 %).
export async function checkComposition(comp: MotionComposition, sources: MotionSources, names: string[], width: number, height: number): Promise<CheckResult> {
  let box: MotionSandbox | null = null;
  try {
    const assets = await sandboxAssets(sources, names, 720);
    box = await createSandbox({ code: comp.code, width, height, duration: comp.duration, fps: 30, assets, background: comp.background });
    const videos = new ExactVideos(comp, sources, 480, 30);
    const D = comp.duration;
    const moments = [0, 0.15, 0.32, 0.5, 0.68, 0.85, 0.999].map((p) => Math.min(D - 1 / 30, p * D));
    const posters: string[] = [];
    let varied = 0;
    for (const [k, t] of moments.entries()) {
      const bitmap = await box.frame(t, await videos.at(t));
      if (variety(bitmap) > 6) varied++;
      if (k === 1 || k === 3 || k === 5) posters.push(poster(bitmap));
      bitmap.close();
    }
    if (varied < 3) return { ok: false, error: 'Кадры почти пустые: на большей части ролика виден только фон.' };
    return { ok: true, posters };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  } finally {
    box?.destroy();
  }
}

export interface CompositionRenderOptions {
  comp: MotionComposition;
  sources: MotionSources;
  names: string[];
  width: number;
  height: number;
  fps: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export async function renderComposition(o: CompositionRenderOptions): Promise<RenderResult> {
  const long = Math.max(o.width, o.height);
  const assets = await sandboxAssets(o.sources, o.names, Math.min(4096, long * 1.5));
  const box = await createSandbox({ code: o.comp.code, width: o.width, height: o.height, duration: o.comp.duration, fps: o.fps, assets, background: o.comp.background });
  const videos = new ExactVideos(o.comp, o.sources, long, o.fps);
  try {
    return await encodeFrames({
      duration: o.comp.duration,
      width: o.width,
      height: o.height,
      fps: o.fps,
      onProgress: o.onProgress,
      signal: o.signal,
      frame: async (t) => box.frame(t, await videos.at(t)),
      release: (img) => (img as ImageBitmap).close?.(),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error(describeError(e));
  } finally {
    box.destroy();
  }
}

export interface Player {
  play(): void;
  pause(): void;
  seekTo(t: number): void;
  destroy(): void;
}

// Live preview on a canvas: frames are asked for as fast as the sandbox draws them, at the time the
// clock says, so a slow machine shows fewer frames but never runs slow.
export async function startPlayer(
  canvas: HTMLCanvasElement,
  comp: MotionComposition,
  sources: MotionSources,
  names: string[],
  on: { time: (t: number) => void; playing: (p: boolean) => void; error: (msg: string) => void }
): Promise<Player> {
  const assets = await sandboxAssets(sources, names, Math.max(canvas.width, canvas.height) * 1.5);
  const box = await createSandbox({ code: comp.code, width: canvas.width, height: canvas.height, duration: comp.duration, fps: 30, assets, background: comp.background });
  const live = new LiveVideos(comp, sources, Math.max(canvas.width, canvas.height));
  const ctx = canvas.getContext('2d')!;
  let destroyed = false;
  let playing = false;
  let token = 0;
  let pos = 0;

  const draw = async (t: number, isPlaying: boolean) => {
    const bitmap = await box.frame(t, await live.at(t, isPlaying));
    if (!destroyed) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  };
  const fail = (e: unknown) => {
    if (destroyed) return;
    playing = false;
    live.pause();
    on.playing(false);
    on.error(describeError(e));
  };
  const loop = async (my: number) => {
    const startAt = performance.now() - pos * 1000;
    while (!destroyed && playing && my === token) {
      const t = (performance.now() - startAt) / 1000;
      if (t >= comp.duration) {
        pos = 0;
        playing = false;
        live.pause();
        on.time(comp.duration);
        on.playing(false);
        return;
      }
      pos = t;
      on.time(t);
      try {
        await draw(t, true);
      } catch (e) {
        fail(e);
        return;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  };
  const player: Player = {
    play() {
      if (destroyed || playing) return;
      if (pos >= comp.duration - 0.05) pos = 0;
      playing = true;
      on.playing(true);
      void loop(++token);
    },
    pause() {
      playing = false;
      token++;
      live.pause();
      on.playing(false);
    },
    seekTo(t: number) {
      pos = Math.max(0, Math.min(comp.duration, t));
      on.time(pos);
      if (playing) void loop(++token); // carries on playing from there
      else draw(pos, false).catch(fail);
    },
    destroy() {
      destroyed = true;
      playing = false;
      token++;
      live.pause();
      box.destroy();
    },
  };
  await draw(Math.min(comp.duration * 0.15, 1.5), false).catch(fail);
  return player;
}

