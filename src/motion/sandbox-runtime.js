// Motion Engine sandbox runtime. Runs ONLY inside the sandbox (src/motion/sandbox.ts): an iframe
// with an opaque origin and a CSP that allows no network, and inside a worker there when the
// browser allows one. It is loaded as text (?raw) and never runs in the app's own page.
//
// Claude Opus writes the animation as `function frame(ctx, t, env)` (see the prompt in
// supabase/functions/motion-storyboard); this file gives that code its helpers, draws every frame
// it is asked for on an OffscreenCanvas (a plain canvas where there is none) and hands the picture
// back as an ImageBitmap. Frames may be asked for in any order, so `frame` must be a pure function
// of t: Math.random is re-seeded before each frame and the clocks are frozen to t.
// eslint-disable-next-line no-unused-vars
function motionRuntime(send, listen) {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const map = (x, a, b, c, d, clampIt = true) => {
    let p = (x - a) / (b - a || 1e-9);
    if (clampIt) p = clamp(p);
    return c + (d - c) * p;
  };
  const prog = (t, start, dur) => clamp((t - start) / (dur || 1e-9));
  const pulse = (t, start, dur) => Math.sin(Math.PI * prog(t, start, dur));

  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  const c3 = c1 + 1;
  const ease = {
    linear: (x) => clamp(x),
    inQuad: (x) => clamp(x) ** 2,
    outQuad: (x) => 1 - (1 - clamp(x)) ** 2,
    inOutQuad: (x) => ((x = clamp(x)) < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
    inCubic: (x) => clamp(x) ** 3,
    outCubic: (x) => 1 - (1 - clamp(x)) ** 3,
    inOutCubic: (x) => ((x = clamp(x)) < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    inQuart: (x) => clamp(x) ** 4,
    outQuart: (x) => 1 - (1 - clamp(x)) ** 4,
    inOutQuart: (x) => ((x = clamp(x)) < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
    inExpo: (x) => ((x = clamp(x)) === 0 ? 0 : 2 ** (10 * x - 10)),
    outExpo: (x) => ((x = clamp(x)) === 1 ? 1 : 1 - 2 ** (-10 * x)),
    inOutExpo: (x) => ((x = clamp(x)) === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
    inSine: (x) => 1 - Math.cos((clamp(x) * Math.PI) / 2),
    outSine: (x) => Math.sin((clamp(x) * Math.PI) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * clamp(x)) - 1) / 2,
    inBack: (x) => ((x = clamp(x)), c3 * x ** 3 - c1 * x * x),
    outBack: (x) => ((x = clamp(x)), 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2),
    inOutBack: (x) =>
      (x = clamp(x)) < 0.5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2,
    outElastic: (x) => ((x = clamp(x)) === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    outBounce: (x) => {
      x = clamp(x);
      const n = 7.5625;
      const d = 2.75;
      if (x < 1 / d) return n * x * x;
      if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
      if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
      return n * (x -= 2.625 / d) * x + 0.984375;
    },
    // a damped spring settling on 1; k = stiffness (higher = faster, more wobble)
    spring: (x, k = 8) => ((x = clamp(x)), 1 - Math.exp(-k * x * 0.75) * Math.cos(k * x * 1.4)),
  };

  // seeded random numbers: rng(seed) → () => [0, 1)
  const rng = (seed = 1) => {
    let a = (Math.floor(seed * 9301 + 49297) >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  // smooth value noise in [-1, 1]
  const noise = (x, y = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return (lerp(lerp(a, b, u), lerp(c, d, u), v) - 0.5) * 2;
  };

  const parseColor = (c) => {
    if (typeof c !== 'string') return [0, 0, 0, 1];
    let s = c.trim();
    if (s[0] === '#') {
      s = s.slice(1);
      if (s.length === 3 || s.length === 4) s = [...s].map((ch) => ch + ch).join('');
      const n = parseInt(s.slice(0, 6), 16);
      const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
      return Number.isNaN(n) ? [0, 0, 0, 1] : [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
    }
    const m = /rgba?\(([^)]+)\)/i.exec(s);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
    }
    return [0, 0, 0, 1];
  };
  // '#ff6a00' with an alpha → 'rgba(255, 106, 0, 0.5)'
  const hex = (c, alpha = 1) => {
    const [r, g, b, a] = parseColor(c);
    return `rgba(${r}, ${g}, ${b}, ${clamp(a * alpha)})`;
  };
  const mix = (a, b, p) => {
    const x = parseColor(a);
    const y = parseColor(b);
    const q = clamp(p);
    return `rgba(${Math.round(lerp(x[0], y[0], q))}, ${Math.round(lerp(x[1], y[1], q))}, ${Math.round(lerp(x[2], y[2], q))}, ${lerp(x[3], y[3], q)})`;
  };

  const rrect = (ctx, x, y, w, h, r = 0) => {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, rr);
      return;
    }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  const FONTS = {
    sans: '"Inter M", system-ui, -apple-system, "Segoe UI", sans-serif',
    geist: '"Geist M", "Inter M", system-ui, sans-serif',
    display: '"Unbounded M", "Inter M", system-ui, sans-serif',
    serif: '"Playfair M", Georgia, "Times New Roman", serif',
    mono: '"JetBrains M", ui-monospace, Menlo, Consolas, monospace',
  };
  const fontOf = (o = {}) => {
    const family = FONTS[o.font] || o.font || FONTS.sans;
    return `${o.italic ? 'italic ' : ''}${o.weight || 700} ${Math.max(1, o.size || 32)}px ${family}`;
  };
  const hasSpacing = (ctx) => 'letterSpacing' in ctx;
  const applyFont = (ctx, o) => {
    ctx.font = fontOf(o);
    if (hasSpacing(ctx)) ctx.letterSpacing = `${(o.spacing || 0) * (o.size || 32)}px`;
  };
  const rawWidth = (ctx, s, o) => {
    const w = ctx.measureText(s).width;
    return hasSpacing(ctx) || !o.spacing ? w : w + (o.spacing * (o.size || 32)) * Math.max(0, [...s].length - 1);
  };
  const measure = (ctx, s, o = {}) => {
    ctx.save();
    applyFont(ctx, o);
    const w = rawWidth(ctx, String(s), o);
    ctx.restore();
    return w;
  };
  const wrapLines = (ctx, s, maxWidth, o) => {
    const out = [];
    for (const para of String(s).split('\n')) {
      if (!maxWidth) {
        out.push(para);
        continue;
      }
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && rawWidth(ctx, next, o) > maxWidth) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const wrap = (ctx, s, maxWidth, o = {}) => {
    ctx.save();
    applyFont(ctx, o);
    const lines = wrapLines(ctx, s, maxWidth, o);
    ctx.restore();
    return lines;
  };
  // Draws text (wrapped to maxWidth if given) and returns { width, height, lines }.
  // o: { size, font: 'sans'|'geist'|'display'|'serif'|'mono', weight, italic, color, alpha, align,
  //      baseline, spacing (em), maxWidth, lineHeight (× size), stroke, strokeWidth }
  const text = (ctx, s, x, y, o = {}) => {
    const size = o.size || 32;
    ctx.save();
    applyFont(ctx, o);
    ctx.textAlign = 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.fillStyle = o.color || '#ffffff';
    const lines = wrapLines(ctx, s, o.maxWidth, o);
    const lh = size * (o.lineHeight || 1.15);
    let width = 0;
    lines.forEach((line, i) => {
      const w = rawWidth(ctx, line, o);
      width = Math.max(width, w);
      const lx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      const ly = y + i * lh;
      const draw = (fn) => {
        if (hasSpacing(ctx) || !o.spacing) {
          fn(line, lx, ly);
          return;
        }
        let cx = lx;
        for (const ch of line) {
          fn(ch, cx, ly);
          cx += ctx.measureText(ch).width + o.spacing * size;
        }
      };
      if (o.stroke) {
        ctx.strokeStyle = o.stroke;
        ctx.lineWidth = o.strokeWidth || Math.max(1, size * 0.04);
        ctx.lineJoin = 'round';
        draw((c, a, b) => ctx.strokeText(c, a, b));
      }
      if (o.color !== 'none') draw((c, a, b) => ctx.fillText(c, a, b));
    });
    ctx.restore();
    return { width, height: lines.length ? (lines.length - 1) * lh + size : 0, lines };
  };

  // An image or video frame filling the box, cropped like CSS object-fit: cover.
  // o: { zoom (1 = fit), fx / fy (focus 0…1, default 0.5), alpha, radius }
  const cover = (ctx, img, x, y, w, h, o = {}) => {
    if (!img) return;
    const iw = img.width || img.videoWidth || 1;
    const ih = img.height || img.videoHeight || 1;
    const k = Math.max(w / iw, h / ih) * (o.zoom || 1);
    const dw = iw * k;
    const dh = ih * k;
    const fx = o.fx === undefined ? 0.5 : o.fx;
    const fy = o.fy === undefined ? 0.5 : o.fy;
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    rrect(ctx, x, y, w, h, o.radius || 0);
    ctx.clip();
    ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
    ctx.restore();
  };
  // The whole image inside the box (object-fit: contain), centred.
  const contain = (ctx, img, x, y, w, h, o = {}) => {
    if (!img) return;
    const iw = img.width || 1;
    const ih = img.height || 1;
    const k = Math.min(w / iw, h / ih) * (o.zoom || 1);
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.drawImage(img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
    ctx.restore();
  };

  // ---------------------------------------------------------------------------------------------
  let canvas = null;
  let ctx = null;
  let env = null;
  let frameFn = null;
  let background = '#000000';

  const freezeClocks = (t) => {
    Math.random = rng(9973);
    Date.now = () => 1767225600000 + Math.round(t * 1000);
    if (typeof performance !== 'undefined') {
      try {
        performance.now = () => t * 1000;
      } catch {
        // read-only in this browser: the prompt already forbids using it
      }
    }
  };
  // the line of the model's code an error points at (V8 numbers Function code from its own header)
  const errorLine = (err, offset) => {
    const m = /<anonymous>:(\d+):\d+/.exec(String((err && err.stack) || ''));
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > offset ? n - offset : undefined;
  };
  const describe = (err) => (err && err.message ? `${err.name || 'Error'}: ${err.message}` : String(err));

  const HEADER = [
    'const { W, H, duration, fps, assets, fonts, clamp, lerp, map, prog, pulse, ease, rng, noise, hex, mix, rrect, text, measure, wrap, cover, contain } = env;',
    'return (function () {',
  ];

  async function init(msg) {
    const { W, H } = msg;
    background = msg.background || '#000000';
    // fonts arrive as bytes: nothing is fetched from inside the sandbox
    const fontSet = typeof self !== 'undefined' && self.fonts ? self.fonts : typeof document !== 'undefined' ? document.fonts : null;
    if (fontSet && typeof FontFace !== 'undefined') {
      await Promise.all(
        (msg.fonts || []).map(async (f) => {
          try {
            const face = new FontFace(f.family, f.data, { weight: '100 900', unicodeRange: f.unicodeRange || undefined });
            await face.load();
            fontSet.add(face);
          } catch {
            // a font that does not load falls back to the next one in the stack
          }
        })
      );
    }
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    ctx = canvas.getContext('2d', { alpha: false });
    env = {
      W,
      H,
      duration: msg.duration,
      fps: msg.fps,
      assets: (msg.assets || []).map((a) => ({ kind: a.kind, w: a.width, h: a.height, name: a.name || '', image: a.image || null })),
      fonts: FONTS,
      clamp,
      lerp,
      map,
      prog,
      pulse,
      ease,
      rng,
      noise,
      hex,
      mix,
      rrect,
      text,
      measure,
      wrap,
      cover,
      contain,
    };
    let compiled;
    try {
      const body = `${HEADER.join('\n')}\n${msg.code}\n;return { setup: typeof setup === 'function' ? setup : null, frame: typeof frame === 'function' ? frame : null };\n})();`;
      compiled = new Function('env', body)(env);
    } catch (err) {
      send({ type: 'error', stage: 'compile', message: describe(err), line: errorLine(err, HEADER.length + 2) });
      return;
    }
    if (!compiled || typeof compiled.frame !== 'function') {
      send({ type: 'error', stage: 'compile', message: 'В коде нет функции frame(ctx, t, env).' });
      return;
    }
    frameFn = compiled.frame;
    try {
      freezeClocks(0);
      if (compiled.setup) compiled.setup(env);
    } catch (err) {
      send({ type: 'error', stage: 'setup', message: describe(err), line: errorLine(err, HEADER.length + 2) });
      return;
    }
    send({ type: 'ready' });
  }

  function frame(msg) {
    if (!frameFn) {
      send({ type: 'error', id: msg.id, stage: 'frame', message: 'not ready' });
      return;
    }
    for (const [i, bitmap] of Object.entries(msg.videos || {})) {
      const a = env.assets[Number(i)];
      if (!a) {
        bitmap.close && bitmap.close();
        continue;
      }
      if (a.image && a.image !== bitmap && a.image.close && a.kind === 'video') a.image.close();
      a.image = bitmap;
    }
    const t = Math.max(0, Math.min(msg.t, env.duration));
    try {
      freezeClocks(t);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, env.W, env.H);
      frameFn(ctx, t, env);
      ctx.restore();
    } catch (err) {
      try {
        ctx.restore();
      } catch {
        // nothing to restore
      }
      send({ type: 'error', id: msg.id, stage: 'frame', t, message: describe(err), line: errorLine(err, HEADER.length + 2) });
      return;
    }
    const finish = (bitmap) => send({ type: 'frame', id: msg.id, bitmap }, [bitmap]);
    if (canvas.transferToImageBitmap) finish(canvas.transferToImageBitmap());
    else createImageBitmap(canvas).then(finish, (err) => send({ type: 'error', id: msg.id, stage: 'frame', message: describe(err) }));
  }

  listen((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') send({ type: 'pong' });
    else if (msg.type === 'init') init(msg).catch((err) => send({ type: 'error', stage: 'init', message: describe(err) }));
    else if (msg.type === 'frame') frame(msg);
  });
}
