// Photos attached to a generation, made fit to send. The functions refuse a photo over ~9 MB or in
// a format the models do not take (HEIC from the iPad Files app), and a phone photo or a generated
// 4K picture is often one of those. A photo larger than maxSide, heavier than maxChars or not
// PNG/JPEG/WebP is redrawn as a JPEG; links and anything the browser cannot decode pass unchanged
// (the function then refuses them with the reason).
export interface PhotoFit {
  maxSide: number;
  maxChars: number;
}
// video models take a reference as a frame or a guide: 2048 px is plenty
export const VIDEO_PHOTO_FIT: PhotoFit = { maxSide: 2048, maxChars: 4_000_000 };
// image models edit the photo itself, so they keep more detail; 8 photos of 5M chars stay under
// the functions' 48 MB request ceiling
export const IMAGE_PHOTO_FIT: PhotoFit = { maxSide: 3072, maxChars: 5_000_000 };
const SENDABLE = /^data:image\/(png|jpeg|webp)[;,]/i;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image did not decode'));
    img.src = src;
  });
}

export async function fitPhoto(ref: string, fit: PhotoFit = VIDEO_PHOTO_FIT): Promise<string> {
  if (!ref.startsWith('data:image/')) return ref;
  let img: HTMLImageElement;
  try {
    img = await loadImage(ref);
  } catch {
    return ref;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return ref;
  if (SENDABLE.test(ref) && Math.max(w, h) <= fit.maxSide && ref.length <= fit.maxChars) return ref;
  const k = Math.min(1, fit.maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  if (!ctx) return ref;
  ctx.fillStyle = '#fff'; // JPEG has no transparency: see-through areas turn white, not black
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

export async function fitPhotos(refs: string[] | undefined, fit: PhotoFit = VIDEO_PHOTO_FIT): Promise<string[] | undefined> {
  return refs ? await Promise.all(refs.map((r) => fitPhoto(r, fit))) : refs;
}
