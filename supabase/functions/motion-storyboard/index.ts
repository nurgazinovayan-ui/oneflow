// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "motion-storyboard" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY — the same key generate-*/evaluate-creative already use.
// Requires the generation_log table (see admin-list-generations) — every call is logged there
// with its real OpenRouter cost, like every other paid call.
//
// Motion Engine (src/components/MotionEnginePanel.tsx): the user's photos, video keyframes and
// brief go to Claude Opus 5.5. Two modes:
//   mode 'storyboard' (default) → a storyboard as JSON — scenes with timing, layout, which asset
//     each scene uses, on-screen text, camera move, transition — plus the video's look (palette,
//     font, effects). The client draws the static board and renders the video from the same JSON
//     in the browser (src/motion/render.ts); this function never touches video itself.
//   mode 'styles' → 4 distinct style directions for this brief; the one the user picks is sent
//     back as `style` on later storyboard calls and pins their look.
//
// Body: { mode?, brief, duration, aspect, assets: [{ kind, name, duration?, frames: [dataUrl] }],
//         previous?: string[], style?: StyleDirection }
//   previous = one-line summaries of what was already made (variants or style names), so a new
//   call asks for something genuinely different rather than a reshuffle.
// → { storyboard, costUsd } | { styles, costUsd }

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-opus-5.5';
const MODEL_LABEL = 'ONEFLOW Motion Engine'; // what users see in their generation history
// Fallback pricing (USD per token) when OpenRouter doesn't report usage.cost — its public
// $4 / $20 per million input/output tokens for this model.
const PRICE_IN = 4 / 1_000_000;
const PRICE_OUT = 20 / 1_000_000;

const MAX_ASSETS = 8;
const MAX_FRAMES_TOTAL = 16;
const MAX_FRAME_CHARS = 900_000; // one downscaled JPEG data URL
const MAX_BRIEF = 4000;
const MIN_DURATION = 3;
const MAX_DURATION = 120;

const LAYOUTS = ['full', 'split-left', 'split-right', 'center-card', 'grid', 'text-only', 'caption-bottom'] as const;
const CAMERAS = ['static', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'drift'] as const;
const TEXT_ANIMS = ['fade-up', 'slide-left', 'scale', 'mask-up', 'words', 'type', 'blur-in', 'tracking'] as const;
const TRANSITIONS = ['cut', 'fade', 'slide', 'zoom', 'wipe', 'glitch', 'flash', 'blur', 'push-up'] as const;
const FONTS = ['sans', 'serif', 'mono', 'display'] as const;
const FX = ['grain', 'glow', 'vignette', 'letterbox', 'duotone'] as const;
const PACES = ['calm', 'medium', 'fast'] as const;

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function getCaller(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

// What the renderer can do — shared by both prompts so Claude never asks for an effect that
// doesn't exist.
const ENGINE = `Возможности движка (используй только их):
- layout: full — материал на весь кадр, текст поверх; split-left/split-right — материал на половине кадра (слева/справа, в вертикальном формате — сверху/снизу), текст на другой половине; center-card — материал карточкой по центру на цветном фоне; grid — 2–4 материала сеткой; text-only — только текст на фоне; caption-bottom — материал на весь кадр, текст плашкой снизу.
- camera (движение по материалу внутри сцены): static, zoom-in, zoom-out, pan-left, pan-right, pan-up, pan-down, drift (медленный диагональный дрейф с лёгким наездом).
- textAnim (как появляется текст): fade-up, slide-left, scale, mask-up (строки выезжают из-под маски), words (по словам), type (печатная машинка), blur-in (из размытия в резкость), tracking (буквы сходятся из широкой разрядки).
- transition (как сцена сменяет предыдущую): cut, fade, slide, zoom, wipe (шторка акцентным цветом), glitch (цифровой сбой с RGB-сдвигом), flash (вспышка), blur (через размытие), push-up (сдвиг вверх).
- fx (эффекты на весь ролик, 0–3 шт.): grain (плёночное зерно), glow (неоновое свечение текста и акцентов), vignette (затемнение краёв), letterbox (кинематографичные чёрные полосы), duotone (материалы перекрашены в два цвета стиля).
- font: sans (современный гротеск), display (жирный плотный гротеск для крупных заголовков), serif (антиква, премиально/редакционно), mono (моноширинный, tech).`;

const STORYBOARD_PROMPT = `Ты — моушн-дизайнер и режиссёр рекламных роликов уровня дорогих SaaS-брендов. По материалам пользователя (фото, кадры из видео, текст задачи) ты придумываешь раскадровку короткого ролика, который потом автоматически анимирует движок.

${ENGINE}

Ответь СТРОГО одним JSON-объектом без markdown и пояснений:
{
  "title": "короткое название идеи ролика",
  "concept": "1–2 предложения: в чём идея и почему она сработает",
  "style": { "bg": "#RRGGBB", "ink": "#RRGGBB", "accent": "#RRGGBB", "font": "sans|serif|mono|display", "mood": "2–4 слова", "fx": ["..."] },
  "scenes": [
    {
      "dur": <секунды, число>,
      "layout": "...",
      "asset": <номер материала с 0 или null>,
      "assets": [<номера для layout grid, 2–4 шт.>],
      "headline": "главный текст сцены (коротко, до ~40 символов) или пустая строка",
      "sub": "второстепенный текст (до ~80 символов) или пустая строка",
      "cta": "текст кнопки-призыва (только в финальной сцене, иначе пустая строка)",
      "camera": "...",
      "textAnim": "...",
      "transition": "...",
      "bg": "#RRGGBB или пустая строка",
      "note": "одна фраза для пользователя: что происходит в кадре и зачем"
    }
  ]
}

Правила:
- Сумма dur всех сцен должна быть равна длительности ролика. Обычно сцена 1.5–5 секунд, динамичнее — короче.
- Используй материалы пользователя; каждый материал, который он дал, по возможности хотя бы раз. Номера материалов — как в списке «Материал N». Видео-материалы в ролике проигрываются, фото — анимируются камерой.
- Весь текст в кадре — на языке задачи пользователя (по умолчанию русский), живой рекламный язык, без воды. Не выдумывай цены, скидки, факты и обещания, которых нет в задаче.
- Композиция под указанный формат кадра: для вертикального — крупные тексты и layout full/caption-bottom/center-card, для горизонтального — можно split.
- Цвета стиля бери из материалов/бренда; ink должен хорошо читаться на bg.
- Эффекты и переходы — осмысленно, под настроение: glitch/flash хороши для дерзкого и tech, blur/fade — для спокойного и премиального. Не ставь glitch в каждую сцену.
- Финальная сцена — сильная точка: логотип/название/призыв, если это уместно по задаче.`;

const STYLES_PROMPT = `Ты — арт-директор моушн-роликов. По материалам и задаче пользователя предложи 4 РАЗНЫХ стилевых направления для рекламного ролика — от ожидаемого до смелого. Направления должны заметно отличаться палитрой, шрифтом, темпом и эффектами, но каждое должно подходить бренду и задаче.

${ENGINE}

Ответь СТРОГО одним JSON-объектом без markdown и пояснений:
{
  "styles": [
    {
      "name": "короткое название направления, 1–3 слова",
      "description": "одно предложение: какое ощущение и почему подходит",
      "sample": "пример короткой фразы в кадре в этом стиле (до ~30 символов, на языке задачи, без выдуманных фактов)",
      "style": { "bg": "#RRGGBB", "ink": "#RRGGBB", "accent": "#RRGGBB", "font": "...", "mood": "2–4 слова", "fx": ["..."] },
      "pace": "calm|medium|fast",
      "layouts": ["2–4 любимых layout этого стиля"],
      "cameras": ["2–3 camera"],
      "textAnims": ["1–3 textAnim"],
      "transitions": ["1–3 transition"]
    }
  ]
}
ink должен хорошо читаться на bg. Цвета бери из материалов/бренда, если они есть.`;

type AssetIn = { kind: 'image' | 'video'; name: string; duration?: number; frames: string[] };

const pickOne = <T extends string>(v: unknown, list: readonly T[], def: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : def);
const pickMany = <T extends string>(v: unknown, list: readonly T[], max: number): T[] =>
  [...new Set((Array.isArray(v) ? v : []).filter((x) => (list as readonly string[]).includes(String(x))))].slice(0, max) as T[];
const hex = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : def);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function normStyle(raw: any) {
  return {
    bg: hex(raw?.bg, '#0f1222'),
    ink: hex(raw?.ink, '#ffffff'),
    accent: hex(raw?.accent, '#3b5cff'),
    font: pickOne(raw?.font, FONTS, 'sans'),
    mood: str(raw?.mood, 60),
    fx: pickMany(raw?.fx, FX, 3),
  };
}

function normDirection(raw: any, i: number) {
  return {
    id: `s${Date.now().toString(36)}${i}`,
    name: str(raw?.name, 40) || `Стиль ${i + 1}`,
    description: str(raw?.description, 220),
    sample: str(raw?.sample, 60),
    style: normStyle(raw?.style),
    pace: pickOne(raw?.pace, PACES, 'medium'),
    layouts: pickMany(raw?.layouts, LAYOUTS, 4),
    cameras: pickMany(raw?.cameras, CAMERAS, 3),
    textAnims: pickMany(raw?.textAnims, TEXT_ANIMS, 3),
    transitions: pickMany(raw?.transitions, TRANSITIONS, 3),
  };
}

// Clamp everything the model says to what the renderer understands, so a slightly-off answer
// still renders instead of breaking the client. A pinned style direction overrides the look.
function normalize(raw: any, duration: number, assetCount: number, pinned: ReturnType<typeof normDirection> | null) {
  const idx = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < assetCount ? (v as number) : null);
  const style = pinned ? { ...pinned.style } : normStyle(raw?.style);
  let scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, 24).map((s: any) => {
    const assets = (Array.isArray(s?.assets) ? s.assets : []).map(idx).filter((v: number | null): v is number => v !== null).slice(0, 4);
    const asset = idx(s?.asset) ?? (assets.length ? assets[0] : null);
    let layout = pickOne(s?.layout, LAYOUTS, asset === null ? 'text-only' : 'full');
    if (layout === 'grid' && assets.length < 2) layout = asset === null ? 'text-only' : 'full';
    if (layout !== 'text-only' && layout !== 'grid' && asset === null) layout = 'text-only';
    return {
      dur: Math.max(0.5, Number(s?.dur) || 2),
      layout,
      asset,
      assets: layout === 'grid' ? assets : [],
      headline: str(s?.headline, 90),
      sub: str(s?.sub, 160),
      cta: str(s?.cta, 40),
      camera: pickOne(s?.camera, CAMERAS, 'zoom-in'),
      textAnim: pickOne(s?.textAnim, TEXT_ANIMS, 'fade-up'),
      transition: pickOne(s?.transition, TRANSITIONS, 'fade'),
      bg: hex(s?.bg, ''),
      note: str(s?.note, 200),
    };
  });
  if (!scenes.length) throw new Error('Модель не вернула ни одной сцены.');
  // scale durations so they add up to exactly the requested length
  const total = scenes.reduce((a: number, s: { dur: number }) => a + s.dur, 0);
  let t = 0;
  scenes = scenes.map((s: { dur: number }, i: number) => {
    const dur = i === scenes.length - 1 ? Math.max(0.3, duration - t) : Math.round((s.dur / total) * duration * 100) / 100;
    const out = { ...s, start: Math.round(t * 100) / 100, dur: Math.round(dur * 100) / 100 };
    t += dur;
    return out;
  });
  return { title: str(raw?.title, 80) || 'Раскадровка', concept: str(raw?.concept, 400), style, duration, scenes };
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Модель ответила не в формате JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: 'Not authenticated.' }, 401);
    if (!OPENROUTER_API_KEY) return json({ error: 'OPENROUTER_API_KEY is not configured.' }, 500);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'styles' ? 'styles' : 'storyboard';
    const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, MAX_BRIEF) : '';
    const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(Number(body.duration) || 15)));
    const aspect = typeof body.aspect === 'string' && /^\d{1,2}:\d{1,2}$/.test(body.aspect) ? body.aspect : '16:9';
    const assets: AssetIn[] = (Array.isArray(body.assets) ? body.assets : []).slice(0, MAX_ASSETS).map((a: any) => ({
      kind: a?.kind === 'video' ? 'video' : 'image',
      name: String(a?.name ?? '').slice(0, 80),
      duration: Number(a?.duration) || undefined,
      frames: (Array.isArray(a?.frames) ? a.frames : [])
        .filter((f: unknown) => typeof f === 'string' && f.startsWith('data:image/') && f.length <= MAX_FRAME_CHARS)
        .slice(0, 3),
    }));
    const previous: string[] = (Array.isArray(body.previous) ? body.previous : []).filter((p: unknown) => typeof p === 'string').slice(-12).map((p: string) => p.slice(0, 300));
    const pinned = mode === 'storyboard' && body.style && typeof body.style === 'object' ? normDirection(body.style, 0) : null;
    if (pinned) pinned.name = str(body.style.name, 40) || pinned.name;
    if (!brief && !assets.length) return json({ error: 'Добавьте материалы или опишите задачу.' }, 400);

    const [w, h] = aspect.split(':').map(Number);
    const orientation = w > h ? 'горизонтальный' : w < h ? 'вертикальный' : 'квадратный';
    const lines = [
      `Задача пользователя: ${brief || '(не указана — придумай по материалам)'}`,
      `Длительность ролика: ${duration} с. Формат кадра: ${aspect} (${orientation}).`,
      assets.length ? `Материалов: ${assets.length}.` : 'Материалов нет — только текст и графика (layout text-only).',
    ];
    if (pinned) {
      lines.push(
        `Выбранный пользователем стиль «${pinned.name}» — держись его строго: палитра bg ${pinned.style.bg}, ink ${pinned.style.ink}, accent ${pinned.style.accent}, font ${pinned.style.font}, fx [${pinned.style.fx.join(', ')}], темп ${pinned.pace}` +
          `${pinned.layouts.length ? `, любимые layout: ${pinned.layouts.join(', ')}` : ''}${pinned.cameras.length ? `, camera: ${pinned.cameras.join(', ')}` : ''}` +
          `${pinned.textAnims.length ? `, textAnim: ${pinned.textAnims.join(', ')}` : ''}${pinned.transitions.length ? `, transition: ${pinned.transitions.join(', ')}` : ''}. ${pinned.description}`
      );
    }
    if (previous.length) {
      lines.push(`${mode === 'styles' ? 'Уже предложенные направления' : 'Уже сделанные варианты'} (придумай заметно другое):\n- ${previous.join('\n- ')}`);
    }
    const content: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] = [{ type: 'text', text: lines.join('\n') }];
    let budget = MAX_FRAMES_TOTAL;
    assets.forEach((a, i) => {
      content.push({ type: 'text', text: `Материал ${i}: ${a.kind === 'video' ? `видео${a.duration ? `, ${a.duration.toFixed(1)} с` : ''}${a.frames.length > 1 ? `, ${a.frames.length} кадра` : ''}` : 'фото'} «${a.name}»` });
      for (const f of a.frames) if (budget-- > 0) content.push({ type: 'image_url', image_url: { url: f } });
    });

    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: mode === 'styles' ? STYLES_PROMPT : STORYBOARD_PROMPT }, { role: 'user', content }],
        max_tokens: mode === 'styles' ? 3000 : 6000,
        temperature: mode === 'styles' || previous.length ? 1 : 0.8,
        usage: { include: true },
      }),
    });
    if (!res.ok) {
      console.error('OpenRouter error', res.status, await res.text());
      return json({ error: 'Не удалось получить ответ от модели. Попробуйте ещё раз.' }, 502);
    }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};
    const costUsd = Number(usage.cost) || (Number(usage.prompt_tokens) || 0) * PRICE_IN + (Number(usage.completion_tokens) || 0) * PRICE_OUT;
    const parsed = extractJson(text) as any;

    const result = mode === 'styles'
      ? { styles: (Array.isArray(parsed?.styles) ? parsed.styles : []).slice(0, 6).map(normDirection) }
      : { storyboard: normalize(parsed, duration, assets.length, pinned) };
    if ('styles' in result && !result.styles.length) throw new Error('Модель не предложила ни одного стиля.');

    const { error: logError } = await supabaseAdmin.from('generation_log')
      .insert({ user_id: caller.id, email: caller.email, model: MODEL_LABEL, category: 'motion', cost_usd: costUsd });
    if (logError) console.error('Failed to log generation', logError);

    return json({ ...result, costUsd });
  } catch (err) {
    console.error(err);
    return json({ error: 'Не удалось выполнить запрос. Попробуйте ещё раз.' }, 500);
  }
});
