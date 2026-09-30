// Motion Engine renderer: draws any moment of a storyboard onto a 2D canvas. The same function
// paints the static storyboard frames, the live preview and every frame of the exported video,
// so all three always agree. Everything is sized from the canvas itself, which is what lets one
// storyboard render at any resolution and aspect ratio.
import type { MotionCamera, MotionScene, MotionStoryboard, MotionTextAnim } from './types';

export interface MotionSource {
  el: CanvasImageSource;
  width: number;
  height: number;
  video?: HTMLVideoElement;
}
export type MotionSources = (MotionSource | null | undefined)[];

const FONT_STACK: Record<string, string> = {
  sans: '"Inter Variable", Inter, system-ui, sans-serif',
  display: '"Inter Variable", Inter, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
};
const WEIGHT: Record<string, number> = { sans: 700, display: 800, serif: 600, mono: 600 };
const TEXT_IN = 0.6; // seconds each text element takes to animate in

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const v = clamp01(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
const smooth = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2;

function rgba(hex: string, a: number): string {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
  return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;
}

export function sceneIndexAt(board: MotionStoryboard, t: number): number {
  for (let i = 0; i < board.scenes.length; i++) {
    const s = board.scenes[i];
    if (t < s.start + s.dur) return i;
  }
  return board.scenes.length - 1;
}

const transitionLength = (s: MotionScene, first: boolean) =>
  first ? Math.min(0.5, s.dur * 0.3) : s.transition === 'cut' ? 0 : Math.min(0.6, s.dur * 0.3);

export function sceneMedia(s: MotionScene): number[] {
  if (s.layout === 'grid') return s.assets;
  if (s.layout === 'text-only' || s.asset === null) return [];
  return [s.asset];
}

// Which asset is on screen at time t, and at which point of its own scene — the export seeks
// every video to exactly this before drawing a frame.
function activeMedia(board: MotionStoryboard, t: number): Map<number, number> {
  const out = new Map<number, number>();
  const i = sceneIndexAt(board, t);
  const s = board.scenes[i];
  const local = t - s.start;
  if (i > 0 && local < transitionLength(s, false)) {
    const p = board.scenes[i - 1];
    for (const a of sceneMedia(p)) out.set(a, p.dur + local);
  }
  for (const a of sceneMedia(s)) out.set(a, local);
  return out;
}

function seek(v: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - time) < 0.002 && v.readyState >= 2) return resolve();
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 4000);
    v.addEventListener('seeked', done);
    v.currentTime = time;
  });
}

// Puts every on-screen video at the right frame for time t (videos loop if the scene outlasts them).
export async function prepareFrame(board: MotionStoryboard, sources: MotionSources, t: number): Promise<void> {
  await Promise.all(
    [...activeMedia(board, t)].map(([i, time]) => {
      const v = sources[i]?.video;
      if (!v) return undefined;
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      return seek(v, d > 0.2 ? time % (d - 0.05) : 0);
    })
  );
}

// ---------------------------------------------------------------------------------------------

interface Ctx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  board: MotionStoryboard;
  sources: MotionSources;
  still: boolean;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawMedia(c: Ctx, asset: number | null, x: number, y: number, w: number, h: number, camera: MotionCamera, p: number, radius = 0) {
  const { ctx } = c;
  const src = asset === null ? null : c.sources[asset];
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  if (!src || !src.width || !src.height) {
    ctx.fillStyle = rgba(c.board.style.ink, 0.08);
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }
  const e = smooth(p);
  const cover = Math.max(w / src.width, h / src.height);
  let z = 1;
  let ox = 0;
  let oy = 0;
  if (camera === 'zoom-in') z = 1 + 0.12 * e;
  else if (camera === 'zoom-out') z = 1.12 - 0.12 * e;
  else if (camera !== 'static') z = 1.12;
  const dw = src.width * cover * z;
  const dh = src.height * cover * z;
  const rx = (dw - w) / 2;
  const ry = (dh - h) / 2;
  if (camera === 'pan-left') ox = rx * (1 - 2 * e);
  else if (camera === 'pan-right') ox = -rx * (1 - 2 * e);
  else if (camera === 'pan-up') oy = ry * (1 - 2 * e);
  else if (camera === 'pan-down') oy = -ry * (1 - 2 * e);
  ctx.drawImage(src.el, x + w / 2 - dw / 2 + ox, y + h / 2 - dh / 2 + oy, dw, dh);
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[][] {
  const lines: string[][] = [];
  for (const para of text.split('\n')) {
    let line: string[] = [];
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = [...line, word];
      if (line.length && ctx.measureText(next.join(' ')).width > maxW) {
        lines.push(line);
        line = [word];
      } else line = next;
    }
    if (line.length) lines.push(line);
  }
  return lines;
}

interface TextBox {
  x: number; // left edge (align left) or center (align center)
  y: number;
  w: number;
  align: 'left' | 'center';
  anchor: 'top' | 'bottom' | 'center';
  size: number; // headline px
  ink: string;
  shadow?: boolean;
}

function setFont(c: Ctx, size: number, weight: number) {
  const f = c.board.style.font;
  c.ctx.font = `${weight} ${Math.round(size)}px ${FONT_STACK[f] ?? FONT_STACK.sans}`;
  const ls = f === 'display' ? -0.035 : f === 'mono' ? 0 : -0.02;
  (c.ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(ls * size).toFixed(2)}px`;
}

// Measures the headline/sub/CTA block for a box (so panels can be sized to it) — and draws it
// when draw is set, animated by the scene's textAnim.
function textBlock(c: Ctx, s: MotionScene, local: number, box: TextBox, draw: boolean): number {
  const { ctx } = c;
  const weight = WEIGHT[c.board.style.font] ?? 700;
  const hs = box.size;
  const ss = hs * 0.42;
  setFont(c, hs, weight);
  const hLines = s.headline ? wrap(ctx, s.headline, box.w) : [];
  const hLH = hs * 1.08;
  setFont(c, ss, 450);
  const sLines = s.sub ? wrap(ctx, s.sub, box.w) : [];
  const sLH = ss * 1.4;
  const gap = hs * 0.35;
  const ctaH = s.cta ? hs * 0.95 : 0;
  const height = hLines.length * hLH + (sLines.length ? (hLines.length ? gap : 0) + sLines.length * sLH : 0) + (ctaH ? gap * 1.4 + ctaH : 0);
  if (!draw) return height;

  let y = box.anchor === 'top' ? box.y : box.anchor === 'bottom' ? box.y - height : box.y - height / 2;
  const at = (delay: number) => (c.still ? 1 : clamp01((local - delay) / TEXT_IN));
  const base = ctx.globalAlpha;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = box.ink;
  if (box.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = hs * 0.25;
  }

  // headline
  setFont(c, hs, weight);
  const anim: MotionTextAnim = s.textAnim;
  const chars = s.headline.length;
  const typed = c.still ? chars : Math.floor(chars * clamp01((local - 0.15) / Math.max(0.6, chars / 26)));
  let charCount = 0;
  hLines.forEach((words, li) => {
    const lineText = words.join(' ');
    const lw = ctx.measureText(lineText).width;
    const lx = box.align === 'center' ? box.x - lw / 2 : box.x;
    const baseY = y + hs * 0.9;
    const lineDelay = 0.15 + li * 0.08;
    const e = easeOut(at(lineDelay));
    ctx.save();
    if (anim === 'mask-up') {
      ctx.beginPath();
      ctx.rect(lx - hs, y - hs * 0.1, lw + hs * 2, hLH + hs * 0.15);
      ctx.clip();
      ctx.globalAlpha = base;
      ctx.fillText(lineText, lx, baseY + (1 - e) * hLH);
    } else if (anim === 'words') {
      let wx = lx;
      words.forEach((word, wi) => {
        const we = easeOut(at(0.15 + (li * 4 + wi) * 0.07));
        ctx.globalAlpha = base * we;
        ctx.fillText(word, wx, baseY + (1 - we) * hs * 0.45);
        wx += ctx.measureText(word + ' ').width;
      });
    } else if (anim === 'type') {
      const shown = Math.max(0, Math.min(lineText.length, typed - charCount));
      const part = lineText.slice(0, shown);
      ctx.globalAlpha = base;
      ctx.fillText(part, lx, baseY);
      const typingHere = !c.still && typed < chars && typed >= charCount && typed <= charCount + lineText.length;
      if (typingHere && Math.floor(local * 3) % 2 === 0) {
        ctx.fillRect(lx + ctx.measureText(part).width + hs * 0.06, y + hs * 0.12, hs * 0.07, hs * 0.86);
      }
    } else {
      ctx.globalAlpha = base * e;
      let dx = 0;
      let dy = 0;
      if (anim === 'fade-up') dy = (1 - e) * hs * 0.5;
      if (anim === 'slide-left') dx = (1 - e) * c.W * 0.06;
      if (anim === 'scale') {
        const sc = 0.86 + 0.14 * e;
        const cx = lx + lw / 2;
        const cy = y + hLH / 2;
        ctx.translate(cx, cy);
        ctx.scale(sc, sc);
        ctx.translate(-cx, -cy);
      }
      ctx.fillText(lineText, lx + dx, baseY + dy);
    }
    ctx.restore();
    charCount += lineText.length + 1;
    y += hLH;
  });

  // sub
  if (sLines.length) {
    if (hLines.length) y += gap;
    setFont(c, ss, 450);
    const e = easeOut(at(0.45));
    ctx.globalAlpha = base * e * 0.82;
    sLines.forEach((words) => {
      const t = words.join(' ');
      const lw = ctx.measureText(t).width;
      ctx.fillText(t, box.align === 'center' ? box.x - lw / 2 : box.x, y + ss * 1.05 + (1 - e) * ss * 0.6);
      y += sLH;
    });
  }

  // CTA pill
  if (ctaH) {
    y += gap * 1.4;
    ctx.shadowColor = 'transparent';
    setFont(c, hs * 0.4, 650);
    const tw = ctx.measureText(s.cta).width;
    const pw = tw + hs * 1.1;
    const px = box.align === 'center' ? box.x - pw / 2 : box.x;
    const e = easeOut(at(0.7));
    ctx.save();
    ctx.globalAlpha = base * e;
    const cx = px + pw / 2;
    const cy = y + ctaH / 2;
    ctx.translate(cx, cy);
    ctx.scale(0.8 + 0.2 * e, 0.8 + 0.2 * e);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = c.board.style.accent;
    roundRect(ctx, px, y, pw, ctaH, ctaH / 2);
    ctx.fill();
    ctx.fillStyle = readableOn(c.board.style.accent);
    ctx.fillText(s.cta, px + hs * 0.55, y + ctaH / 2 + hs * 0.14);
    ctx.restore();
  }
  ctx.globalAlpha = base;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  return height;
}

function readableOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0f1222' : '#ffffff';
}

function drawScene(c: Ctx, s: MotionScene, local: number) {
  const { ctx, W, H, board } = c;
  const base = ctx.globalAlpha;
  const bg = s.bg || board.style.bg;
  const ink = board.style.ink;
  const portrait = H > W * 1.05;
  const m = Math.min(W, H);
  const pad = m * 0.075;
  const p = clamp01(local / s.dur);
  const hasText = Boolean(s.headline || s.sub || s.cta);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  switch (s.layout) {
    case 'full': {
      drawMedia(c, s.asset, 0, 0, W, H, s.camera, p);
      if (hasText) {
        ctx.globalAlpha = base * 0.3;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = base;
        const w = portrait ? W - pad * 2 : W * 0.62;
        textBlock(c, s, local, { x: pad, y: H - pad, w, align: 'left', anchor: 'bottom', size: m * (portrait ? 0.085 : 0.08), ink, shadow: true }, true);
      }
      break;
    }
    case 'caption-bottom': {
      drawMedia(c, s.asset, 0, 0, W, H, s.camera, p);
      if (hasText) {
        const size = m * (portrait ? 0.07 : 0.065);
        const w = W - pad * 2;
        const th = textBlock(c, s, local, { x: pad, y: 0, w, align: 'left', anchor: 'top', size, ink }, false);
        const ph = th + pad * 1.4;
        const e = c.still ? 1 : easeOut(local / 0.5);
        ctx.fillStyle = rgba(bg, 0.92);
        ctx.fillRect(0, H - ph * e, W, ph);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, H - ph * e, W, ph);
        ctx.clip();
        textBlock(c, s, local, { x: pad, y: H - ph * e + pad * 0.7, w, align: 'left', anchor: 'top', size, ink }, true);
        ctx.restore();
      }
      break;
    }
    case 'split-left':
    case 'split-right': {
      const mediaFirst = s.layout === 'split-left';
      const e = c.still ? 1 : easeOut(local / 0.7);
      if (portrait) {
        const mh = H * 0.55;
        const my = mediaFirst ? 0 : H - mh;
        drawMedia(c, s.asset, 0, my + (mediaFirst ? -1 : 1) * (1 - e) * mh * 0.08, W, mh, s.camera, p);
        const ty = mediaFirst ? mh : 0;
        textBlock(c, s, local, { x: pad, y: ty + (H - mh) / 2, w: W - pad * 2, align: 'left', anchor: 'center', size: m * 0.085, ink }, true);
      } else {
        const mw = W * 0.5;
        const mx = mediaFirst ? 0 : W - mw;
        drawMedia(c, s.asset, mx + (mediaFirst ? -1 : 1) * (1 - e) * mw * 0.08, 0, mw, H, s.camera, p);
        const tx = mediaFirst ? mw + pad : pad;
        textBlock(c, s, local, { x: tx, y: H / 2, w: W - mw - pad * 2, align: 'left', anchor: 'center', size: m * 0.075, ink }, true);
      }
      break;
    }
    case 'center-card': {
      const src = s.asset === null ? null : c.sources[s.asset];
      const ar = src && src.width && src.height ? src.width / src.height : 1;
      const boxW = portrait ? W * 0.78 : W * 0.5;
      const boxH = hasText ? H * (portrait ? 0.5 : 0.55) : H * 0.72;
      let cw = boxW;
      let ch = cw / ar;
      if (ch > boxH) {
        ch = boxH;
        cw = ch * ar;
      }
      const cx = (W - cw) / 2;
      const top = hasText ? (portrait ? H * 0.14 : H * 0.1) : (H - ch) / 2;
      const e = c.still ? 1 : easeOut(local / 0.7);
      ctx.save();
      const sc = 0.9 + 0.1 * e;
      ctx.translate(W / 2, top + ch / 2);
      ctx.scale(sc, sc);
      ctx.translate(-W / 2, -(top + ch / 2));
      ctx.globalAlpha = base * e;
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = m * 0.06;
      ctx.shadowOffsetY = m * 0.02;
      ctx.fillStyle = bg;
      roundRect(ctx, cx, top, cw, ch, m * 0.03);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      drawMedia(c, s.asset, cx, top, cw, ch, s.camera, p, m * 0.03);
      ctx.restore();
      ctx.globalAlpha = base;
      if (hasText) textBlock(c, s, local, { x: W / 2, y: top + ch + m * 0.07, w: W - pad * 2, align: 'center', anchor: 'top', size: m * (portrait ? 0.075 : 0.068), ink }, true);
      break;
    }
    case 'grid': {
      const n = s.assets.length;
      const g = m * 0.018;
      const textH = hasText ? H * (portrait ? 0.3 : 0.26) : 0;
      const gw = W - pad * 2;
      const gh = H - pad * 2 - textH;
      const cols = n === 4 ? 2 : portrait ? 1 : n;
      const rows = Math.ceil(n / cols);
      const tw = (gw - g * (cols - 1)) / cols;
      const th = (gh - g * (rows - 1)) / rows;
      s.assets.forEach((a, k) => {
        const col = k % cols;
        const row = Math.floor(k / cols);
        const e = c.still ? 1 : easeOut((local - k * 0.12) / 0.6);
        const x = pad + col * (tw + g);
        const y = pad + row * (th + g);
        ctx.save();
        ctx.globalAlpha = base * e;
        const cx = x + tw / 2;
        const cy = y + th / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.92 + 0.08 * e, 0.92 + 0.08 * e);
        ctx.translate(-cx, -cy);
        drawMedia(c, a, x, y, tw, th, s.camera, p, m * 0.02);
        ctx.restore();
      });
      ctx.globalAlpha = base;
      if (hasText) textBlock(c, s, local, { x: pad, y: H - pad, w: gw, align: 'left', anchor: 'bottom', size: m * (portrait ? 0.07 : 0.062), ink }, true);
      break;
    }
    default: {
      // text-only
      const e = c.still ? 1 : easeOut(local / 0.6);
      ctx.fillStyle = board.style.accent;
      const bw = m * 0.12 * e;
      ctx.fillRect(W / 2 - bw / 2, H / 2 - m * 0.26, bw, m * 0.012);
      textBlock(c, s, local, { x: W / 2, y: H / 2 + m * 0.02, w: W - pad * 2.4, align: 'center', anchor: 'center', size: m * 0.1, ink }, true);
    }
  }
  ctx.globalAlpha = base;
}

// One frame of the video at time t, transitions included.
export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, board: MotionStoryboard, sources: MotionSources, t: number) {
  const c: Ctx = { ctx, W, H, board, sources, still: false };
  const i = sceneIndexAt(board, t);
  const s = board.scenes[i];
  const local = Math.max(0, t - s.start);
  const T = transitionLength(s, i === 0);
  ctx.save();
  ctx.globalAlpha = 1;
  if (T > 0 && local < T) {
    const e = easeInOut(local / T);
    if (i === 0) {
      ctx.fillStyle = s.bg || board.style.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = easeOut(local / T);
      drawScene(c, s, local);
    } else {
      const prev = board.scenes[i - 1];
      const prevLocal = prev.dur + local;
      if (s.transition === 'slide') {
        ctx.save();
        ctx.translate(-W * 0.3 * e, 0);
        drawScene(c, prev, prevLocal);
        ctx.restore();
        ctx.save();
        ctx.translate(W * (1 - e), 0);
        drawScene(c, s, local);
        ctx.restore();
      } else if (s.transition === 'zoom') {
        drawScene(c, prev, prevLocal);
        ctx.save();
        ctx.globalAlpha = e;
        const z = 1.15 - 0.15 * e;
        ctx.translate(W / 2, H / 2);
        ctx.scale(z, z);
        ctx.translate(-W / 2, -H / 2);
        drawScene(c, s, local);
        ctx.restore();
      } else if (s.transition === 'wipe') {
        drawScene(c, prev, prevLocal);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W * e, H);
        ctx.clip();
        drawScene(c, s, local);
        ctx.restore();
        ctx.fillStyle = board.style.accent;
        ctx.fillRect(W * e - Math.min(W, H) * 0.01, 0, Math.min(W, H) * 0.01, H);
      } else {
        drawScene(c, prev, prevLocal);
        ctx.globalAlpha = e;
        drawScene(c, s, local);
      }
    }
  } else {
    drawScene(c, s, local);
  }
  ctx.restore();
}

// The static storyboard frame of one scene: everything settled, no transition.
export function drawStill(ctx: CanvasRenderingContext2D, W: number, H: number, board: MotionStoryboard, sources: MotionSources, index: number) {
  const s = board.scenes[index];
  ctx.save();
  drawScene({ ctx, W, H, board, sources, still: true }, s, Math.min(s.dur * 0.5, 1));
  ctx.restore();
}

// Frame size for an aspect ratio at a quality (short side), rounded to even numbers for H.264.
export function frameSize(aspect: string, short: number): { width: number; height: number } {
  const [a, b] = aspect.split(':').map(Number);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  if (!a || !b) return { width: even(short * 16 / 9), height: short };
  return a >= b ? { width: even((short * a) / b), height: even(short) } : { width: even(short), height: even((short * b) / a) };
}
