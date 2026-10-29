// Motion Engine sound: the soundtrack of a composition, mixed offline in the browser.
// - Each clip of a video plays its own sound at its volume, cut to exactly the clip (with a few
//   milliseconds of fade so cuts don't click).
// - The music material plays under everything from its `from`, lowered while a clip with clearly
//   audible sound is on (the loud stretches found in src/motion/footage.ts), and fades out at the end.
// Each file is decoded once and only the pieces the clips use are kept, one file at a time, so a few
// long videos don't hold hundreds of megabytes at once (an iPad above all).
import type { MotionAsset, MotionComposition } from './types';

const RATE = 48000;
const EDGE = 0.02; // seconds of fade at every cut
const DUCK = 0.3; // music level under a clip that keeps its sound
const FADE_OUT = 1.2;

async function decode(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const ctx = new OfflineAudioContext(2, RATE, RATE);
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null; // no sound track, or one this browser cannot decode
  }
}

// A copy of [from, from + seconds) of a decoded track, so the whole track can be let go.
function piece(src: AudioBuffer, from: number, seconds: number): AudioBuffer {
  const a = Math.max(0, Math.floor(from * src.sampleRate));
  const len = Math.max(1, Math.min(src.length - a, Math.ceil(seconds * src.sampleRate)));
  const out = new AudioBuffer({ length: len, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
  for (let c = 0; c < src.numberOfChannels; c++) out.copyToChannel(src.getChannelData(c).subarray(a, a + len), c);
  return out;
}

const volumeOf = (v: number | undefined) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v as number)) : 1);

export interface Mix {
  buffer: AudioBuffer;
  hasMusic: boolean;
  clipsWithSound: number;
}

export async function mixComposition(comp: MotionComposition, assets: (MotionAsset | null)[]): Promise<Mix | null> {
  const D = comp.duration;
  const clips = comp.clips.filter((c) => assets[c.asset]?.kind === 'video' && volumeOf(c.volume) > 0.01 && c.end > c.start);
  const music = comp.music && assets[comp.music.asset]?.kind === 'audio' && comp.music.volume > 0.01 ? comp.music : null;
  if (!clips.length && !music) return null;

  type Piece = { at: number; buffer: AudioBuffer; volume: number };
  const pieces: Piece[] = [];
  const audible: [number, number][] = []; // composition seconds where a clip's own sound is clearly heard
  for (const index of [...new Set(clips.map((c) => c.asset))]) {
    const asset = assets[index]!;
    if (asset.footage && !asset.footage.audio.has) continue;
    const track = await decode(asset.blob);
    if (!track) continue;
    for (const c of clips.filter((x) => x.asset === index)) {
      const len = c.end - c.start;
      if (c.from >= track.duration) continue;
      pieces.push({ at: c.start, buffer: piece(track, c.from, len), volume: volumeOf(c.volume) });
      if (volumeOf(c.volume) >= 0.3) {
        for (const [a, b] of asset.footage?.audio.loud ?? [[c.from, c.from + len]]) {
          const s = Math.max(c.start, c.start + (a - c.from));
          const e = Math.min(c.end, c.start + (b - c.from));
          if (e > s) audible.push([s, e]);
        }
      }
    }
  }
  let musicPiece: AudioBuffer | null = null;
  if (music) {
    const track = await decode(assets[music.asset]!.blob);
    if (track && music.from < track.duration) musicPiece = piece(track, music.from, D);
  }
  if (!pieces.length && !musicPiece) return null;

  const ctx = new OfflineAudioContext(2, Math.ceil(D * RATE), RATE);
  for (const p of pieces) {
    const src = ctx.createBufferSource();
    src.buffer = p.buffer;
    const g = ctx.createGain();
    const end = Math.min(D, p.at + p.buffer.duration);
    g.gain.setValueAtTime(0, p.at);
    g.gain.linearRampToValueAtTime(p.volume, p.at + EDGE);
    g.gain.setValueAtTime(p.volume, Math.max(p.at + EDGE, end - EDGE));
    g.gain.linearRampToValueAtTime(0, end);
    src.connect(g).connect(ctx.destination);
    src.start(p.at, 0, end - p.at);
  }
  if (musicPiece && music) {
    const src = ctx.createBufferSource();
    src.buffer = musicPiece;
    const g = ctx.createGain();
    const v = volumeOf(music.volume);
    g.gain.setValueAtTime(v, 0);
    // lowered under speech / sound kept from the videos, with quarter-second ramps
    const merged = audible.sort((x, y) => x[0] - y[0]).reduce<[number, number][]>((out, cur) => {
      const last = out[out.length - 1];
      if (last && cur[0] - last[1] < 0.6) last[1] = Math.max(last[1], cur[1]);
      else out.push([cur[0], cur[1]]);
      return out;
    }, []);
    for (const [a, b] of merged) {
      g.gain.setValueAtTime(v, Math.max(0, a - 0.25));
      g.gain.linearRampToValueAtTime(v * DUCK, a);
      g.gain.setValueAtTime(v * DUCK, b);
      g.gain.linearRampToValueAtTime(v, Math.min(D, b + 0.25));
    }
    const fadeAt = Math.max(0, Math.min(D, musicPiece.duration) - FADE_OUT);
    g.gain.setValueAtTime(v, fadeAt);
    g.gain.linearRampToValueAtTime(0, Math.min(D, musicPiece.duration));
    src.connect(g).connect(ctx.destination);
    src.start(0);
  }
  return { buffer: await ctx.startRendering(), hasMusic: Boolean(musicPiece), clipsWithSound: pieces.length };
}
