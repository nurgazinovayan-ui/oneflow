// The demo (?demo=1) has no server, so «Создать ролик» returns this hand-written animation in the
// exact format Claude Opus writes (src/motion/sandbox-runtime.js runs it the same way). It lets the
// whole Motion Engine flow be tried without an account; it is not Opus's work.
import type { MotionComposition, MotionStoryboardRequest } from './types';

const CODE = String.raw`
const PAL = { bg: '#0d0b14', ink: '#fff7ee', accent: '#ff7a3d', violet: '#7c5cff', sun: '#ffd25e' };
const U = () => Math.min(W, H) / 100;
const tall = () => H > W * 1.1;
const media = (i) => (assets.length ? assets[i % assets.length] : null);

function blobs(ctx, t, alpha) {
  const spots = [[PAL.accent, 0.2, 0.28, 1], [PAL.violet, 0.82, 0.72, 1.25], [PAL.sun, 0.62, 0.12, 0.7]];
  spots.forEach(([c, x, y, s], i) => {
    const cx = W * (x + 0.07 * noise(t * 0.3 + i * 11, i));
    const cy = H * (y + 0.07 * noise(i * 5, t * 0.3 + i * 3));
    const r = Math.max(W, H) * 0.42 * s;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, hex(c, 0.5 * alpha));
    g.addColorStop(1, hex(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
}

function gridLines(ctx, t, alpha) {
  const u = U();
  const step = 9 * u;
  const off = (t * 2 * u) % step;
  ctx.save();
  ctx.strokeStyle = hex(PAL.ink, 0.06 * alpha);
  ctx.lineWidth = Math.max(1, u * 0.12);
  for (let x = -step + off; x < W + step; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = -step + off; y < H + step; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

// words rise out of a mask one after another
function rise(ctx, str, x, y, start, t, o) {
  const words = str.split(' ');
  const gap = measure(ctx, ' ', o);
  const widths = words.map((w) => measure(ctx, w, o));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
  let cx = o.align === 'center' ? x - total / 2 : x;
  words.forEach((w, i) => {
    const p = ease.outExpo(prog(t, start + i * 0.07, 0.8));
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - o.size * 0.1, y - o.size * 1.05, widths[i] + o.size * 0.2, o.size * 1.35);
    ctx.clip();
    text(ctx, w, cx, y + (1 - p) * o.size * 1.15, { ...o, align: 'left' });
    ctx.restore();
    cx += widths[i] + gap;
  });
  return total;
}

function grain(ctx, t) {
  const r = rng(Math.floor(t * 24) + 3);
  const u = U();
  ctx.save();
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = hex(r() > 0.5 ? '#ffffff' : '#000000', 0.05 + r() * 0.05);
    ctx.fillRect(r() * W, r() * H, u * 0.18, u * 0.18);
  }
  ctx.restore();
}

function opening(ctx, t, a, b) {
  const u = U();
  const p = prog(t, a, b - a);
  gridLines(ctx, t, 1 - ease.inCubic(p));
  const size = (tall() ? 13 : 10) * u;
  const cy = H * 0.46;
  rise(ctx, 'Ваш продукт', W / 2, cy, a + 0.15, t, { size, font: 'display', weight: 800, color: PAL.ink, align: 'center', spacing: -0.02 });
  rise(ctx, 'в движении', W / 2, cy + size * 1.15, a + 0.4, t, { size, font: 'serif', weight: 500, italic: true, color: PAL.accent, align: 'center' });
  const line = ease.inOutCubic(prog(t, a + 0.7, 0.9));
  ctx.fillStyle = PAL.accent;
  ctx.fillRect(W / 2 - 18 * u * line, cy + size * 1.6, 36 * u * line, u * 0.6);
  // the first material grows out of a circle and becomes the next scene
  const m = media(0);
  const grow = ease.inOutExpo(prog(t, a + (b - a) * 0.55, (b - a) * 0.45));
  if (m && m.image && grow > 0) {
    const r = Math.hypot(W, H) * 0.55 * grow;
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.max(1, r), 0, Math.PI * 2);
    ctx.clip();
    cover(ctx, m.image, 0, 0, W, H, { zoom: 1.35 - 0.2 * grow });
    ctx.restore();
  }
}

function hero(ctx, t, a, b) {
  const u = U();
  const p = prog(t, a, b - a);
  const m = media(0);
  if (m && m.image) cover(ctx, m.image, 0, 0, W, H, { zoom: 1.15 - 0.1 * ease.outCubic(p), fx: 0.5 + 0.08 * Math.sin(p * 2), fy: 0.45 });
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
  g.addColorStop(0, hex(PAL.bg, 0));
  g.addColorStop(1, hex(PAL.bg, 0.9));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const pill = ease.outBack(prog(t, a + 0.2, 0.6));
  if (pill > 0) {
    ctx.save();
    ctx.translate(8 * u, 9 * u);
    ctx.scale(pill, pill);
    rrect(ctx, 0, -4 * u, 17 * u, 6.4 * u, 3.2 * u);
    ctx.fillStyle = PAL.accent;
    ctx.fill();
    text(ctx, 'НОВОЕ', 8.5 * u, 0.6 * u, { size: 2.8 * u, font: 'mono', weight: 700, color: PAL.bg, align: 'center', spacing: 0.12 });
    ctx.restore();
  }
  const size = (tall() ? 9.5 : 7.5) * u;
  rise(ctx, 'Сделано', 8 * u, H - 8 * u - size * 1.15, a + 0.35, t, { size, font: 'display', weight: 800, color: PAL.ink });
  rise(ctx, 'с характером', 8 * u, H - 8 * u, a + 0.5, t, { size, font: 'display', weight: 300, color: PAL.ink });
}

function collage(ctx, t, a, b) {
  const u = U();
  blobs(ctx, t, 0.7);
  const big = tall() ? 30 * u : 26 * u;
  const drift = noise(t * 0.4, 2) * 2 * u;
  text(ctx, 'ДЕТАЛИ', W / 2 + drift, H * 0.56, { size: big, font: 'display', weight: 900, color: 'none', stroke: hex(PAL.ink, 0.22), strokeWidth: u * 0.35, align: 'center', spacing: -0.03 });
  const n = Math.max(1, Math.min(3, assets.length || 1));
  const cw = tall() ? W * 0.62 : W * 0.24;
  const ch = cw * 1.25;
  for (let k = 0; k < n; k++) {
    const m = media(k + 1);
    const enter = ease.outBack(prog(t, a + 0.15 + k * 0.18, 0.9));
    const cx = tall() ? W / 2 + (k - (n - 1) / 2) * W * 0.12 : W / 2 + (k - (n - 1) / 2) * (cw + 3 * u);
    const cy = tall() ? H * 0.32 + k * H * 0.2 : H / 2;
    const rot = (k - (n - 1) / 2) * 0.06 + noise(t * 0.5 + k, k) * 0.02;
    ctx.save();
    ctx.translate(cx, cy + (1 - enter) * H * 0.6 + noise(k * 4, t * 0.6) * 1.5 * u);
    ctx.rotate(rot * enter);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 5 * u;
    ctx.shadowOffsetY = 2 * u;
    rrect(ctx, -cw / 2, -ch / 2, cw, ch, 3 * u);
    ctx.fillStyle = PAL.ink;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (m && m.image) cover(ctx, m.image, -cw / 2 + u, -ch / 2 + u, cw - 2 * u, ch - 2 * u, { radius: 2.4 * u, zoom: 1.08 });
    else {
      rrect(ctx, -cw / 2 + u, -ch / 2 + u, cw - 2 * u, ch - 2 * u, 2.4 * u);
      ctx.fillStyle = mix(PAL.violet, PAL.accent, k / 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function finale(ctx, t, a, b) {
  const u = U();
  const p = prog(t, a, b - a);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, mix(PAL.bg, PAL.violet, 0.55));
  g.addColorStop(1, mix(PAL.bg, PAL.accent, 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 60; i++) {
    const x = r() * W;
    const speed = 4 + r() * 8;
    const y = ((r() * H - (t - a) * speed * u) % H + H) % H;
    ctx.fillStyle = hex(PAL.ink, 0.15 + r() * 0.35);
    ctx.beginPath();
    ctx.arc(x, y, (0.2 + r() * 0.5) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const size = (tall() ? 10 : 8) * u;
  const track = ease.outExpo(prog(t, a + 0.1, 1.2));
  text(ctx, 'Попробуйте', W / 2, H * 0.44, { size, font: 'display', weight: 800, color: PAL.ink, align: 'center', spacing: 0.4 * (1 - track), alpha: track });
  text(ctx, 'сегодня', W / 2, H * 0.44 + size * 1.1, { size, font: 'serif', weight: 500, italic: true, color: PAL.sun, align: 'center', alpha: ease.outCubic(prog(t, a + 0.35, 0.8)) });
  const pop = ease.outBack(prog(t, a + 0.8, 0.7));
  if (pop > 0) {
    const bw = 34 * u;
    const bh = 9 * u;
    ctx.save();
    ctx.translate(W / 2, H * 0.44 + size * 2.4);
    ctx.scale(pop, pop);
    rrect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = PAL.ink;
    ctx.fill();
    text(ctx, 'Узнать больше', 0, bh * 0.14, { size: 3.4 * u, font: 'sans', weight: 700, color: PAL.bg, align: 'center' });
    ctx.restore();
  }
  void p;
}

// a diagonal accent band sweeps across each cut
function wipe(ctx, t, at) {
  const p = prog(t, at - 0.35, 0.7);
  if (p <= 0 || p >= 1) return;
  const e = ease.inOutCubic(p);
  const span = W + H;
  ctx.save();
  ctx.translate(-H + e * (span + H), 0);
  ctx.rotate(-0.35);
  ctx.fillStyle = PAL.accent;
  ctx.fillRect(-W * 0.15, -H, W * 0.3, H * 3);
  ctx.fillStyle = hex(PAL.sun, 0.8);
  ctx.fillRect(W * 0.15, -H, W * 0.04, H * 3);
  ctx.restore();
}

function frame(ctx, t) {
  const D = duration;
  const c1 = D * 0.24;
  const c2 = D * 0.5;
  const c3 = D * 0.76;
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, W, H);
  blobs(ctx, t, 1);
  if (t < c1) opening(ctx, t, 0, c1);
  else if (t < c2) hero(ctx, t, c1, c2);
  else if (t < c3) collage(ctx, t, c2, c3);
  else finale(ctx, t, c3, D);
  wipe(ctx, t, c2);
  wipe(ctx, t, c3);
  grain(ctx, t);
}
`;

export function demoComposition(req: MotionStoryboardRequest): MotionComposition {
  const D = req.duration;
  const r = (x: number) => Math.round(x * 100) / 100;
  const video = req.assets.findIndex((a) => a.kind === 'video');
  return {
    title: 'Продукт в движении',
    concept: 'Демо-пример анимации в формате Opus: заголовок из маски, материал раскрывается из круга, коллаж карточек и финал с призывом.',
    duration: D,
    background: '#0d0b14',
    palette: ['#0d0b14', '#ff7a3d', '#7c5cff', '#ffd25e', '#fff7ee'],
    beats: [
      { start: 0, end: r(D * 0.24), text: 'Заголовок поднимается из маски, первый материал раскрывается из круга' },
      { start: r(D * 0.24), end: r(D * 0.5), text: 'Материал на весь кадр с медленным наездом, плашка «Новое», подпись' },
      { start: r(D * 0.5), end: r(D * 0.76), text: 'Коллаж карточек с материалами на фоне контурного слова' },
      { start: r(D * 0.76), end: D, text: 'Финал: призыв и кнопка на градиенте, летящие частицы' },
    ],
    clips: video >= 0 ? [{ asset: video, start: r(D * 0.24), end: r(D * 0.76), from: 0 }] : [],
    code: CODE.trim(),
  };
}
