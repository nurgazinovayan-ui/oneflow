import { writePsd } from 'ag-psd';
import { loadImage } from './imageAdapt';
import { useLanguageStore, ru, en } from './i18n';

function t() {
  return useLanguageStore.getState().language === 'en' ? en : ru;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Compares two same-sized renders of "the same scene, minus some content" and cuts out
// a transparent layer containing only what differs (with `before`'s pixels), i.e. the
// content that `after` had removed. Edges get a soft alpha ramp instead of a hard cutoff
// to avoid jagged cutout borders.
export async function extractDiffLayer(
  beforeDataUrl: string,
  afterDataUrl: string,
  width: number,
  height: number,
  lowThreshold = 14,
  highThreshold = 45
): Promise<string> {
  const [beforeImg, afterImg] = await Promise.all([loadImage(beforeDataUrl), loadImage(afterDataUrl)]);

  const beforeCanvas = document.createElement('canvas');
  beforeCanvas.width = width;
  beforeCanvas.height = height;
  const beforeCtx = beforeCanvas.getContext('2d');
  const afterCanvas = document.createElement('canvas');
  afterCanvas.width = width;
  afterCanvas.height = height;
  const afterCtx = afterCanvas.getContext('2d');
  if (!beforeCtx || !afterCtx) throw new Error(t().errors.canvasUnavailable);
  beforeCtx.drawImage(beforeImg, 0, 0, width, height);
  afterCtx.drawImage(afterImg, 0, 0, width, height);

  const before = beforeCtx.getImageData(0, 0, width, height);
  const after = afterCtx.getImageData(0, 0, width, height);
  const out = beforeCtx.createImageData(width, height);

  for (let i = 0; i < before.data.length; i += 4) {
    const dr = before.data[i] - after.data[i];
    const dg = before.data[i + 1] - after.data[i + 1];
    const db = before.data[i + 2] - after.data[i + 2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const alpha = Math.max(
      0,
      Math.min(255, Math.round(((dist - lowThreshold) / (highThreshold - lowThreshold)) * 255))
    );
    out.data[i] = before.data[i];
    out.data[i + 1] = before.data[i + 1];
    out.data[i + 2] = before.data[i + 2];
    out.data[i + 3] = alpha;
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error(t().errors.canvasUnavailable);
  outCtx.putImageData(out, 0, 0);
  return outCanvas.toDataURL('image/png');
}

// Builds a layered .psd (returned as a data: URL) from a stack of same-sized
// images. `layers[0]` becomes the bottom-most layer, later entries stack above it.
export async function buildLayeredPsdDataUrl(
  width: number,
  height: number,
  layers: { name: string; dataUrl: string }[]
): Promise<string> {
  const children = [];
  for (const layer of layers) {
    const img = await loadImage(layer.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t().errors.canvasUnavailable);
    ctx.drawImage(img, 0, 0, width, height);
    children.push({ name: layer.name, canvas, top: 0, left: 0, bottom: height, right: width });
  }
  const buffer = writePsd({ width, height, children });
  return `data:application/octet-stream;base64,${arrayBufferToBase64(buffer)}`;
}
