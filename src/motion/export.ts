// Motion Engine export: renders a storyboard frame by frame (src/motion/render.ts) and encodes
// it in the browser — WebCodecs H.264 (VP9 where the browser has no H.264 encoder) + mp4-muxer
// → .mp4, at any size up to 4K. Deterministic:
// every frame waits for its videos to seek, so a slow machine takes longer but never drops frames.
// Without WebCodecs (old browsers) it falls back to recording the canvas in real time → .webm.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { drawFrame, prepareFrame, type MotionSources } from './render';
import type { MotionStoryboard } from './types';

export interface RenderOptions {
  board: MotionStoryboard;
  sources: MotionSources;
  width: number;
  height: number;
  fps: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

// Any source of frames: the storyboard renderer below, or Opus's animation code in the sandbox
// (src/motion/composition.ts). frame(t) gives the picture at time t; release() frees it once encoded.
export interface FrameJob {
  duration: number;
  width: number;
  height: number;
  fps: number;
  frame: (t: number) => Promise<CanvasImageSource>;
  release?: (img: CanvasImageSource) => void;
  audio?: AudioBuffer | null; // the mixed soundtrack (src/motion/audioMix.ts), MP4 only
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  codec: string;
  // the sound written into the file; null when there was sound but this browser cannot encode it
  audio?: 'AAC' | 'Opus' | null;
}

interface AudioChoice {
  codec: string;
  mux: 'aac' | 'opus';
  label: 'AAC' | 'Opus';
}

// AAC first (every player and ad platform), Opus where the browser has no AAC encoder (Chrome on
// Linux); null when neither can be encoded here.
async function chooseAudio(buffer: AudioBuffer): Promise<AudioChoice | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', label: 'AAC' }, { codec: 'opus', mux: 'opus', label: 'Opus' }] as const) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels, bitrate: 160_000 });
      if (r.supported) return c;
    } catch {
      // not this one
    }
  }
  return null;
}

async function encodeAudio(muxer: Muxer<ArrayBufferTarget>, buffer: AudioBuffer, choice: AudioChoice): Promise<void> {
  let failure: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({ codec: choice.codec, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels, bitrate: 160_000 });
  const block = 4800; // 0.1 s at 48 kHz
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  try {
    for (let at = 0; at < buffer.length; at += block) {
      if (failure) throw failure;
      const n = Math.min(block, buffer.length - at);
      const planar = new Float32Array(n * channels.length);
      channels.forEach((ch, c) => planar.set(ch.subarray(at, at + n), c * n));
      const data = new AudioData({ format: 'f32-planar', sampleRate: buffer.sampleRate, numberOfFrames: n, numberOfChannels: channels.length, timestamp: Math.round((at / buffer.sampleRate) * 1e6), data: planar });
      encoder.encode(data);
      data.close();
      while (encoder.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 2));
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

interface Choice {
  codec: string;
  mux: 'avc' | 'vp9';
  label: string;
}

// Lowest H.264 High-profile level that fits the frame size and rate (Table A-1 limits).
function avcCodec(width: number, height: number, fps: number): string | null {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = mbs * fps;
  const levels: [number, number, string][] = [
    [8192, 245760, '28'], // 4.0
    [8704, 522240, '2a'], // 4.2
    [22080, 589824, '32'], // 5.0
    [36864, 983040, '33'], // 5.1
    [36864, 2073600, '34'], // 5.2
    [139264, 4177920, '3c'], // 6.0
  ];
  const l = levels.find(([maxMbs, maxRate]) => mbs <= maxMbs && rate <= maxRate);
  return l ? `avc1.6400${l[2]}` : null;
}

function vp9Codec(width: number, height: number, fps: number): string {
  const px = width * height;
  const level = px <= 2228224 ? (fps > 30 ? '41' : '40') : px <= 8912896 ? (fps > 30 ? '51' : '50') : '60';
  return `vp09.00.${level}.08`;
}

const bitrateFor = (w: number, h: number, fps: number) => Math.round(Math.min(60e6, Math.max(2e6, w * h * fps * 0.12)));

async function supported(codec: string, width: number, height: number, fps: number): Promise<boolean> {
  try {
    const r = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: bitrateFor(width, height, fps) });
    return Boolean(r.supported);
  } catch {
    return false;
  }
}

// H.264 first (plays everywhere, every ad platform takes it), VP9-in-MP4 if there's no H.264 encoder.
async function chooseCodec(width: number, height: number, fps: number): Promise<Choice | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  const avc = avcCodec(width, height, fps);
  if (avc && (await supported(avc, width, height, fps))) return { codec: avc, mux: 'avc', label: 'H.264' };
  const vp9 = vp9Codec(width, height, fps);
  if (await supported(vp9, width, height, fps)) return { codec: vp9, mux: 'vp9', label: 'VP9' };
  return null;
}

// Whether this browser can encode MP4 at this size — the panel greys out sizes that can't.
export async function canEncodeMp4(width: number, height: number, fps: number): Promise<boolean> {
  return Boolean(await chooseCodec(width, height, fps));
}

export const canRecordWebm = () => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

function abortError() {
  return new DOMException('Рендер остановлен', 'AbortError');
}

export async function renderVideo(o: RenderOptions): Promise<RenderResult> {
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  return encodeFrames({
    duration: o.board.duration,
    width: o.width,
    height: o.height,
    fps: o.fps,
    onProgress: o.onProgress,
    signal: o.signal,
    frame: async (t) => {
      await prepareFrame(o.board, o.sources, t);
      drawFrame(ctx, o.width, o.height, o.board, o.sources, t);
      return canvas;
    },
  });
}

// Encodes whatever a FrameJob draws: MP4 through WebCodecs, else a real-time WebM recording.
export async function encodeFrames(job: FrameJob): Promise<RenderResult> {
  const choice = await chooseCodec(job.width, job.height, job.fps);
  if (choice) {
    const audio = job.audio ? await chooseAudio(job.audio) : null;
    const blob = await renderMp4(job, choice, audio);
    return { blob, ext: 'mp4', codec: audio ? `${choice.label} + ${audio.label}` : choice.label, audio: job.audio ? audio?.label ?? null : undefined };
  }
  if (canRecordWebm()) return { blob: await recordWebm(job), ext: 'webm', codec: 'WebM', audio: job.audio ? null : undefined };
  throw new Error('Этот браузер не умеет кодировать видео. Откройте ONEFLOW в свежем Chrome, Edge или Safari 17+.');
}

async function renderMp4({ duration, width, height, fps, frame: draw, release, audio, onProgress, signal }: FrameJob, choice: Choice, audioChoice: AudioChoice | null): Promise<Blob> {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.mux, width, height, frameRate: fps },
    ...(audio && audioChoice ? { audio: { codec: audioChoice.mux, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } } : {}),
    fastStart: 'in-memory',
  });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({
    codec: choice.codec,
    width,
    height,
    framerate: fps,
    bitrate: bitrateFor(width, height, fps),
    ...(choice.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  });
  const total = Math.max(1, Math.round(duration * fps));
  try {
    for (let n = 0; n < total; n++) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      const t = n / fps;
      const img = await draw(t);
      const frame = new VideoFrame(img, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      release?.(img);
      encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (n % 3 === 0) onProgress?.(n / total);
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (audio && audioChoice) await encodeAudio(muxer, audio, audioChoice);
  muxer.finalize();
  onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

// Fallback: real-time canvas recording. Frames are drawn on a timer, so on a busy machine the
// result can stutter — only used where WebCodecs is missing.
async function recordWebm({ duration, width, height, fps, frame: draw, release, onProgress, signal }: FrameJob): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const stream = canvas.captureStream(fps);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(width, height, fps) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  const paint = async (t: number) => {
    const img = await draw(t);
    if (img !== canvas) ctx.drawImage(img, 0, 0, width, height);
    release?.(img);
  };
  await paint(0);
  rec.start(250);
  const t0 = performance.now();
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) break;
      await paint(t);
      onProgress?.(t / duration);
      await new Promise((r) => setTimeout(r, 1000 / fps / 2));
    }
  } finally {
    rec.stop();
    stream.getTracks().forEach((tr) => tr.stop());
  }
  await stopped;
  onProgress?.(1);
  return new Blob(chunks, { type: 'video/webm' });
}
