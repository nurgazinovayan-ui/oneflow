// Motion Engine media helpers: turning uploaded files into assets, drawable sources for the
// renderer, and small JPEG keyframes for Claude to look at (it never receives the full files).
import type { MotionSource } from './render';
import {
  MOTION_MAX_AUDIO_BYTES,
  MOTION_MAX_AUDIO_SECONDS,
  MOTION_MAX_VIDEO_BYTES,
  MOTION_MAX_VIDEO_SECONDS,
  type MotionAsset,
  type MotionAssetForModel,
} from './types';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть изображение.'));
    img.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('Не удалось открыть видео. Подойдут MP4 (H.264), WebM и MOV из iPhone.'));
    v.src = url;
    v.load();
  });
}

function loadAudio(url: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(a);
    a.onerror = () => reject(new Error('Не удалось открыть аудио. Подойдут MP3, M4A, AAC и WAV.'));
    a.src = url;
  });
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = (bytes: number) => `${Math.round(bytes / 1048576)} МБ`;

// Too long or too heavy for the browser to cut: said in words, the file is not added.
export class MaterialTooBig extends Error {}

export async function fileToAsset(file: File): Promise<MotionAsset> {
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
  if (kind === 'video' && file.size > MOTION_MAX_VIDEO_BYTES) {
    throw new MaterialTooBig(`Видео «${file.name}» весит ${mb(file.size)} — для монтажа подойдут файлы до ${mb(MOTION_MAX_VIDEO_BYTES)}. Сожмите его или загрузите нужный фрагмент.`);
  }
  if (kind === 'audio' && file.size > MOTION_MAX_AUDIO_BYTES) {
    throw new MaterialTooBig(`Аудио «${file.name}» весит ${mb(file.size)} — подойдут файлы до ${mb(MOTION_MAX_AUDIO_BYTES)}.`);
  }
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'image') {
      const img = await loadImage(url);
      return { id: uid(), kind, name: file.name, blob: file, width: img.naturalWidth, height: img.naturalHeight };
    }
    if (kind === 'audio') {
      const a = await loadAudio(url);
      if (a.duration > MOTION_MAX_AUDIO_SECONDS) {
        throw new MaterialTooBig(`Аудио «${file.name}» длится ${mmss(a.duration)} — подойдут треки до ${mmss(MOTION_MAX_AUDIO_SECONDS)}. Обрежьте его.`);
      }
      return { id: uid(), kind, name: file.name, blob: file, width: 0, height: 0, duration: a.duration };
    }
    const v = await loadVideo(url);
    if (v.duration > MOTION_MAX_VIDEO_SECONDS) {
      throw new MaterialTooBig(
        `Видео «${file.name}» длится ${mmss(v.duration)} — для монтажа подойдут ролики до ${mmss(MOTION_MAX_VIDEO_SECONDS)}. Обрежьте его или загрузите нужный фрагмент.`
      );
    }
    return { id: uid(), kind, name: file.name, blob: file, width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The tile picture of an audio material: a note on a gradient.
function noteTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 144;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 144, 144);
  grad.addColorStop(0, '#7c5cff');
  grad.addColorStop(1, '#ff7a3d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 144, 144);
  g.fillStyle = 'rgba(255, 255, 255, 0.92)';
  g.font = '700 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♪', 72, 76);
  return c;
}

// Drawable source for an asset; release() frees the object URL when the asset leaves the panel.
export async function loadSource(asset: MotionAsset): Promise<{ source: MotionSource; release: () => void }> {
  const url = URL.createObjectURL(asset.blob);
  const release = () => URL.revokeObjectURL(url);
  try {
    if (asset.kind === 'image') {
      const img = await loadImage(url);
      return { source: { el: img, width: img.naturalWidth, height: img.naturalHeight }, release };
    }
    if (asset.kind === 'audio') {
      const a = await loadAudio(url);
      a.preload = 'auto';
      const tile = noteTile();
      return { source: { el: tile, width: tile.width, height: tile.height, audio: a }, release };
    }
    const v = await loadVideo(url);
    return { source: { el: v, video: v, width: v.videoWidth, height: v.videoHeight }, release };
  } catch (e) {
    release();
    throw e;
  }
}

function toJpeg(el: CanvasImageSource, w: number, h: number, max = 768): string {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// 1 frame for a photo, 3 (start / middle / end) for a video — what Claude sees of each asset.
export async function framesForModel(asset: MotionAsset, source: MotionSource): Promise<string[]> {
  if (!source.video) return [toJpeg(source.el, source.width, source.height)];
  const v = source.video;
  const d = Number.isFinite(v.duration) ? v.duration : 0;
  const out: string[] = [];
  for (const f of d > 1 ? [0.1, 0.5, 0.9] : [0]) {
    await new Promise<void>((resolve) => {
      const done = () => {
        v.removeEventListener('seeked', done);
        resolve();
      };
      v.addEventListener('seeked', done);
      v.currentTime = d * f;
      setTimeout(done, 3000);
    });
    out.push(toJpeg(v, source.width, source.height));
  }
  return out;
}

// What Opus gets of one material: a photo as one picture; a video as the keyframes, shots and sound
// found when it was added (src/motion/footage.ts), or three frames if that is not done; audio as its
// length only.
export async function assetForModel(asset: MotionAsset, source: MotionSource): Promise<MotionAssetForModel> {
  if (asset.kind === 'audio') return { kind: 'audio', name: asset.name, duration: asset.duration, frames: [] };
  if (asset.kind === 'video' && asset.footage) {
    const f = asset.footage;
    return {
      kind: 'video',
      name: asset.name,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      frames: f.keyframes.map((k) => k.jpeg),
      frameTimes: f.keyframes.map((k) => k.t),
      shots: f.shots,
      audio: f.audio,
    };
  }
  return { kind: asset.kind, name: asset.name, duration: asset.duration, width: asset.width, height: asset.height, frames: await framesForModel(asset, source) };
}

export const newId = uid;
