// Photos attached to a video generation, made fit to send. The video functions refuse a photo over
// ~9 MB or in a format the models do not take (HEIC from the iPad Files app), and a phone photo is
// often both. A photo larger than PHOTO_MAX_SIDE, heavier than PHOTO_MAX_CHARS or not PNG/JPEG/WebP
// is redrawn as a JPEG; links and anything the browser cannot decode pass unchanged (the function
// then refuses them with the reason).
const PHOTO_MAX_SIDE = 2048;
const PHOTO_MAX_CHARS = 4_000_000;
const SENDABLE = /^data:image\/(png|jpeg|webp)[;,]/i;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image did not decode'));
    img.src = src;
  });
}

export async function fitPhoto(ref: string): Promise<string> {
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
  if (SENDABLE.test(ref) && Math.max(w, h) <= PHOTO_MAX_SIDE && ref.length <= PHOTO_MAX_CHARS) return ref;
  const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
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

export async function fitPhotos(refs: string[] | undefined): Promise<string[] | undefined> {
  return refs ? await Promise.all(refs.map(fitPhoto)) : refs;
}
