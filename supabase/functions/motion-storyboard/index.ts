// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "motion-storyboard" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY — the same key generate-*/evaluate-creative already use.
// Requires the generation_log table (see admin-list-generations) — every storyboard is logged
// there with its real OpenRouter cost, like every other paid call.
//
// Motion Engine (src/components/MotionEnginePanel.tsx): the user's photos, video keyframes and
// brief go to Claude Opus 5.5, which answers with a storyboard as JSON — scenes with timing,
// layout, which asset each scene uses, on-screen text, camera move and transition. The client
// draws the static storyboard and later renders the actual video from the same JSON in the
// browser (src/motion/render.ts), so this function never touches video itself.
//
// Body: { brief, duration, aspect, lang?, assets: [{ kind, name, duration?, frames: [dataUrl] }],
//         previous?: string[] }  — previous = one-line summaries of the variants already made,
//         so "Ещё вариант" asks for something genuinely different rather than a reshuffle.
// → { storyboard, costUsd }

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-opus-5.5';
const MODEL_LABEL = 'Claude Opus 5.5';
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
const CAMERAS = ['static', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'] as const;
const TEXT_ANIMS = ['fade-up', 'slide-left', 'scale', 'mask-up', 'words', 'type'] as const;
const TRANSITIONS = ['cut', 'fade', 'slide', 'zoom', 'wipe'] as const;
const FONTS = ['sans', 'serif', 'mono', 'display'] as const;

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

const SYSTEM_PROMPT = `Ты — моушн-дизайнер и режиссёр рекламных роликов уровня дорогих SaaS-брендов. По материалам пользователя (фото, кадры из видео, текст задачи) ты придумываешь раскадровку короткого ролика, который потом автоматически анимирует движок. Движок умеет только то, что описано в схеме ниже, — не придумывай другие эффекты.

Ответь СТРОГО одним JSON-объектом без markdown и пояснений:
{
  "title": "короткое название идеи ролика",
  "concept": "1–2 предложения: в чём идея и почему она сработает",
  "style": { "bg": "#RRGGBB", "ink": "#RRGGBB", "accent": "#RRGGBB", "font": "sans|serif|mono|display", "mood": "2–4 слова" },
  "scenes": [
    {
      "dur": <секунды, число>,
      "layout": "full|split-left|split-right|center-card|grid|text-only|caption-bottom",
      "asset": <номер материала с 0 или null>,
      "assets": [<номера для layout grid, 2–4 шт.>],
      "headline": "главный текст сцены (коротко, до ~40 символов) или пустая строка",
      "sub": "второстепенный текст (до ~80 символов) или пустая строка",
      "cta": "текст кнопки-призыва (только в финальной сцене, иначе пустая строка)",
      "camera": "static|zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down",
      "textAnim": "fade-up|slide-left|scale|mask-up|words|type",
      "transition": "cut|fade|slide|zoom|wipe",
      "bg": "#RRGGBB или пустая строка",
      "note": "одна фраза для пользователя: что происходит в кадре и зачем"
    }
  ]
}

Что значат поля:
- layout: full — материал на весь кадр, текст поверх; split-left/split-right — материал на половине кадра (слева/справа), текст на другой половине; center-card — материал карточкой по центру на цветном фоне; grid — 2–4 материала сеткой; text-only — только текст на фоне; caption-bottom — материал на весь кадр, текст плашкой снизу.
- camera — движение по материалу внутри сцены. transition — как сцена появляется после предыдущей (у первой сцены — как появляется из чёрного/фона).
- Сумма dur всех сцен должна быть равна длительности ролика. Обычно сцена 1.5–5 секунд, динамичнее — короче.

Правила:
- Используй материалы пользователя; каждый материал, который он дал, по возможности хотя бы раз. Номера материалов — как в списке «Материал N». Видео-материалы в ролике проигрываются, фото — анимируются камерой.
- Весь текст в кадре — на языке задачи пользователя (по умолчанию русский), живой рекламный язык, без воды. Не выдумывай цены, скидки, факты и обещания, которых нет в задаче.
- Композиция под указанный формат кадра: для вертикального — крупные тексты и layout full/caption-bottom/center-card, для горизонтального — можно split.
- Цвета стиля бери из материалов/бренда; ink должен хорошо читаться на bg.
- Финальная сцена — сильная точка: логотип/название/призыв, если это уместно по задаче.`;

type Frame = { kind: 'image' | 'video'; name: string; duration?: number; frames: string[] };

// Clamp everything the model says to what the renderer understands, so a slightly-off answer
// still renders instead of breaking the client.
function normalize(raw: any, duration: number, assetCount: number) {
  const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list as readonly string[]).includes(String(v)) ? (v as T) : def;
  const hex = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : def);
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const idx = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < assetCount ? (v as number) : null);

  const style = {
    bg: hex(raw?.style?.bg, '#0f1222'),
    ink: hex(raw?.style?.ink, '#ffffff'),
    accent: hex(raw?.style?.accent, '#3b5cff'),
    font: pick(raw?.style?.font, FONTS, 'sans'),
    mood: str(raw?.style?.mood, 60),
  };
  let scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, 24).map((s: any) => {
    const assets = (Array.isArray(s?.assets) ? s.assets : []).map(idx).filter((v: number | null): v is number => v !== null).slice(0, 4);
    const asset = idx(s?.asset) ?? (assets.length ? assets[0] : null);
    let layout = pick(s?.layout, LAYOUTS, asset === null ? 'text-only' : 'full');
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
      camera: pick(s?.camera, CAMERAS, 'zoom-in'),
      textAnim: pick(s?.textAnim, TEXT_ANIMS, 'fade-up'),
      transition: pick(s?.transition, TRANSITIONS, 'fade'),
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
    const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, MAX_BRIEF) : '';
    const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(Number(body.duration) || 15)));
    const aspect = typeof body.aspect === 'string' && /^\d{1,2}:\d{1,2}$/.test(body.aspect) ? body.aspect : '16:9';
    const assets: Frame[] = (Array.isArray(body.assets) ? body.assets : []).slice(0, MAX_ASSETS).map((a: any) => ({
      kind: a?.kind === 'video' ? 'video' : 'image',
      name: String(a?.name ?? '').slice(0, 80),
      duration: Number(a?.duration) || undefined,
      frames: (Array.isArray(a?.frames) ? a.frames : [])
        .filter((f: unknown) => typeof f === 'string' && f.startsWith('data:image/') && f.length <= MAX_FRAME_CHARS)
        .slice(0, 3),
    }));
    const previous: string[] = (Array.isArray(body.previous) ? body.previous : []).filter((p: unknown) => typeof p === 'string').slice(-12).map((p: string) => p.slice(0, 300));
    if (!brief && !assets.length) return json({ error: 'Добавьте материалы или опишите задачу.' }, 400);

    const [w, h] = aspect.split(':').map(Number);
    const orientation = w > h ? 'горизонтальный' : w < h ? 'вертикальный' : 'квадратный';
    const content: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] = [{
      type: 'text',
      text: [
        `Задача пользователя: ${brief || '(не указана — придумай ролик по материалам)'}`,
        `Длительность ролика: ${duration} с. Формат кадра: ${aspect} (${orientation}).`,
        assets.length ? `Материалов: ${assets.length}.` : 'Материалов нет — делай ролик только из текста и графики (layout text-only).',
        previous.length ? `Уже сделанные варианты (придумай заметно другую идею, структуру и подачу):\n- ${previous.join('\n- ')}` : '',
      ].filter(Boolean).join('\n'),
    }];
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
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
        max_tokens: 6000,
        temperature: previous.length ? 1 : 0.8,
        usage: { include: true },
      }),
    });
    if (!res.ok) {
      console.error('OpenRouter error', res.status, await res.text());
      return json({ error: 'Не удалось получить раскадровку от модели. Попробуйте ещё раз.' }, 502);
    }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};
    const costUsd = Number(usage.cost) || (Number(usage.prompt_tokens) || 0) * PRICE_IN + (Number(usage.completion_tokens) || 0) * PRICE_OUT;

    const storyboard = normalize(extractJson(text), duration, assets.length);
    const { error: logError } = await supabaseAdmin.from('generation_log')
      .insert({ user_id: caller.id, email: caller.email, model: MODEL_LABEL, category: 'motion', cost_usd: costUsd });
    if (logError) console.error('Failed to log generation', logError);

    return json({ storyboard, costUsd });
  } catch (err) {
    console.error(err);
    return json({ error: 'Не удалось сделать раскадровку. Попробуйте ещё раз.' }, 500);
  }
});
