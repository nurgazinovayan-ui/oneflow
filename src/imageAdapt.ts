import { useLanguageStore, ru, en } from './i18n';

function t() {
  return useLanguageStore.getState().language === 'en' ? en : ru;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t().errors.imageLoadFailed));
    img.src = src;
  });
}

// Crops/scales an image (data: URL, always same-origin so canvas export is safe) to
// exactly fill the target pixel dimensions, like CSS object-fit: cover. Flux Kontext already
// generates at (close to) the requested width/height — it only rounds to a multiple of 32 —
// so this is a small ≤16px-per-side correction, not a destructive crop of the composition.
export async function coverResizeExact(
  dataUrl: string,
  width: number,
  height: number
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t().errors.canvasUnavailable);

  const srcRatio = img.width / img.height;
  const dstRatio = width / height;
  let sx: number, sy: number, sw: number, sh: number;
  if (srcRatio > dstRatio) {
    sh = img.height;
    sw = sh * dstRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / dstRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

// Re-encodes an already-loaded image (data: or same-origin URL) into a different
// format for saving. JPEG has no alpha channel, so it gets a white backing fill.
export async function convertImageFormat(
  dataUrl: string,
  format: 'png' | 'jpeg' | 'webp',
  quality = 0.92
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t().errors.canvasUnavailable);
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL(`image/${format}`, quality);
}
