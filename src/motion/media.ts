// Motion Engine media helpers: turning uploaded files into assets, drawable sources for the
// renderer, and small JPEG keyframes for Claude to look at (it never receives the full files).
import type { MotionSource } from './render';
import type { MotionAsset } from './types';

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

export async function fileToAsset(file: File): Promise<MotionAsset> {
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'image') {
      const img = await loadImage(url);
      return { id: uid(), kind, name: file.name, blob: file, width: img.naturalWidth, height: img.naturalHeight };
    }
    const v = await loadVideo(url);
    return { id: uid(), kind, name: file.name, blob: file, width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  } finally {
    URL.revokeObjectURL(url);
  }
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

export const newId = uid;
