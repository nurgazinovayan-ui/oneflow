// Motion Engine footage: what Opus needs to edit a video material, found in the browser when the
// video is added (nothing is uploaded for it):
// - shots: cuts found the same way as for a reference (src/motion/reference.ts findShots), each with
//   its pace;
// - keyframes: up to 8 small JPEGs with their times, across the shots (or across time for one long
//   take), so Opus sees what happens where;
// - audio: whether the video has sound and where it is clearly audible (speech, music), from the
//   loudness of its decoded track, so cuts keep a phrase whole.
import { loadSource } from './media';
import { diff, findShots, gray, jpeg, seek } from './reference';
import type { MotionAsset, MotionFootage } from './types';

const MAX_SHOTS = 30;
const MAX_KEYFRAMES = 8;
const SW = 48;
const SH = 27;

const round = (x: number) => Math.round(x * 100) / 100;

async function audioActivity(blob: Blob): Promise<MotionFootage['audio']> {
  try {
    // decoded at 16 kHz: enough to tell sound from silence, light on memory
    const ctx = new OfflineAudioContext(1, 16000, 16000);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const win = Math.round(audio.sampleRate * 0.5);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const levels: number[] = [];
    for (let s = 0; s < audio.length; s += win) {
      const end = Math.min(audio.length, s + win);
      let sum = 0;
      for (const ch of channels) for (let i = s; i < end; i++) sum += ch[i] * ch[i];
      levels.push(Math.sqrt(sum / Math.max(1, (end - s) * channels.length)));
    }
    const peak = Math.max(0, ...levels);
    if (peak < 0.003) return { has: false, loud: [] };
    const threshold = Math.max(0.01, peak * 0.15);
    const loud: [number, number][] = [];
    levels.forEach((l, i) => {
      if (l < threshold) return;
      const a = i * 0.5;
      const b = a + 0.5;
      const last = loud[loud.length - 1];
      if (last && a - last[1] <= 1) last[1] = b; // a pause under a second does not split a phrase
      else loud.push([a, b]);
    });
    const kept = loud.filter(([a, b]) => b - a >= 0.5);
    // a very busy track: the 40 longest stretches, back in time order
    const top = kept.length > 40 ? [...kept].sort((x, y) => y[1] - y[0] - (x[1] - x[0])).slice(0, 40).sort((x, y) => x[0] - y[0]) : kept;
    return { has: true, loud: top.map(([a, b]) => [round(a), round(Math.min(b, audio.duration))]) };
  } catch {
    return { has: false, loud: [] }; // no audio track, or one this browser cannot decode
  }
}

export async function analyzeFootage(asset: MotionAsset, onProgress?: (p: number) => void): Promise<MotionFootage> {
  const { source, release } = await loadSource(asset); // its own <video>: the board's is left alone
  try {
    const v = source.video!;
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : asset.duration ?? 0;
    const fps = duration <= 60 ? 4 : duration <= 180 ? 2 : 1.5;
    const c = document.createElement('canvas');
    c.width = SW;
    c.height = SH;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const n = Math.max(2, Math.floor(duration * fps));
    const diffs: number[] = [];
    let prev: Float32Array | null = null;
    for (let i = 0; i < n; i++) {
      await seek(v, Math.min(duration - 0.05, i / fps));
      const g = gray(ctx, v);
      diffs.push(prev ? diff(prev, g) : 0);
      prev = g;
      if (i % 4 === 0) onProgress?.((i / n) * 0.75);
    }
    const shots = findShots(diffs, fps, duration, MAX_SHOTS);
    // keyframe moments: the middle of each shot, thinned evenly; one long take → evenly over time
    let times = shots.map((s) => s.start + s.dur / 2);
    if (shots.length < 4 && duration > 8) {
      const count = Math.min(MAX_KEYFRAMES, Math.ceil(duration / 4));
      times = Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);
    }
    if (times.length > MAX_KEYFRAMES) times = Array.from({ length: MAX_KEYFRAMES }, (_, i) => times[Math.round((i * (times.length - 1)) / (MAX_KEYFRAMES - 1))]);
    const keyframes: MotionFootage['keyframes'] = [];
    for (const t of times) {
      await seek(v, Math.min(duration - 0.05, t));
      keyframes.push({ t: round(t), jpeg: jpeg(v, source.width, source.height, 512) });
      onProgress?.(0.75 + (0.15 * keyframes.length) / times.length);
    }
    const audio = await audioActivity(asset.blob);
    onProgress?.(1);
    return { shots, keyframes, audio };
  } finally {
    release();
  }
}
