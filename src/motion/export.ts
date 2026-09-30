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

export interface RenderResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  codec: string;
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
  const choice = await chooseCodec(o.width, o.height, o.fps);
  if (choice) return { blob: await renderMp4(o, choice), ext: 'mp4', codec: choice.label };
  if (canRecordWebm()) return { blob: await recordWebm(o), ext: 'webm', codec: 'WebM' };
  throw new Error('Этот браузер не умеет кодировать видео. Откройте ONEFLOW в свежем Chrome, Edge или Safari 17+.');
}

async function renderMp4({ board, sources, width, height, fps, onProgress, signal }: RenderOptions, choice: Choice): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: choice.mux, width, height, frameRate: fps }, fastStart: 'in-memory' });
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
  const total = Math.max(1, Math.round(board.duration * fps));
  try {
    for (let n = 0; n < total; n++) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      const t = n / fps;
      await prepareFrame(board, sources, t);
      drawFrame(ctx, width, height, board, sources, t);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
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
  muxer.finalize();
  onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

// Fallback: real-time canvas recording. Frames are drawn on a timer, so on a busy machine the
// result can stutter — only used where WebCodecs is missing.
async function recordWebm({ board, sources, width, height, fps, onProgress, signal }: RenderOptions): Promise<Blob> {
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
  await prepareFrame(board, sources, 0);
  drawFrame(ctx, width, height, board, sources, 0);
  rec.start(250);
  const t0 = performance.now();
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const t = (performance.now() - t0) / 1000;
      if (t >= board.duration) break;
      await prepareFrame(board, sources, t);
      drawFrame(ctx, width, height, board, sources, t);
      onProgress?.(t / board.duration);
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
