// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "motion-storyboard" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY — the same key generate-*/evaluate-creative already use.
// Requires the generation_log table (see admin-list-generations) — every call is logged there
// with its real OpenRouter cost, like every other paid call.
//
// Motion Engine (src/components/MotionEnginePanel.tsx): the user's photos, video keyframes and
// brief go to Claude Opus 5.5. Modes:
//   mode 'code' → Opus writes the animation itself: { composition: { title, concept, background,
//     palette, beats, clips, code } }, where code is `function frame(ctx, t, env)` for a Canvas 2D
//     that the browser runs in a sandbox and records to MP4 (src/motion/sandbox.ts). Writing it takes
//     Opus minutes, so it is a background job: the call answers 202 { pending, jobId } at once and
//     the app polls with { jobId } (src/webApi.ts pollJob) until the composition is ready.
//   mode 'fix' → { composition, error }: the browser found an error in that code; Opus returns the
//     corrected composition (a job the same way).
// The older template modes stay for storyboards made before (and for «Предложи стили»):
//   mode 'storyboard' (default) → a storyboard as JSON — scenes with timing, layout, which asset
//     each scene uses, on-screen text, camera move, transition — plus the video's look (palette,
//     font, effects). The client draws the static board and renders the video from the same JSON
//     in the browser (src/motion/render.ts); this function never touches video itself.
//   mode 'styles' → 4 distinct style directions for this brief; the one the user picks is sent
//     back as `style` on later storyboard calls and pins their look.
//
// Body: { mode?, brief, duration, aspect, assets: [{ kind, name, duration?, frames: [dataUrl] }],
//         previous?: string[], style?: StyleDirection, reference?: Reference }
//   reference = the summary the client makes of a video/images the clip should look like
//   (src/motion/reference.ts): shots with timing and motion, palette, one keyframe per shot. The
//   storyboard then mirrors its rhythm, structure and (unless a style is pinned) its look.
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
const MAX_REF_FRAMES = 12;
const MAX_REF_SHOTS = 24;
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

// ---- mode 'code': Claude writes the animation itself.
// Instead of a storyboard for the template renderer, the model writes `function frame(ctx, t, env)`
// — JavaScript that draws any moment of the video on a Canvas 2D. The browser runs it in a sandbox
// (src/motion/sandbox.ts: opaque-origin iframe, no network, a worker, deadlines) and records it to
// MP4 frame by frame. Everything the code may use is described here; src/motion/sandbox-runtime.js
// provides exactly that, so the two must change together.
const RUNTIME_API = `КАК УСТРОЕН КОД
Напиши функцию:
  function frame(ctx, t, env) { … }
— ctx — CanvasRenderingContext2D размером W×H; фон уже залит цветом meta.background. t — секунды от 0 до duration.
— frame — ЧИСТАЯ функция времени: кадры запрашиваются в любом порядке (перемотка, рендер), поэтому никакого состояния между вызовами, никаких счётчиков кадров и накоплений. Math.random перед каждым кадром сбрасывается в одно и то же зерно; для частиц и шума используй rng(seed) и noise().
— Необязательно: function setup(env) { … } — вызывается один раз до первого кадра; только предрасчёт, не зависящий от t.
— Свои функции и константы объявляй на верхнем уровне кода.

ЧТО ДОСТУПНО (переменные уже объявлены):
— W, H — размер кадра в пикселях. Один и тот же код рендерится в разных размерах и пропорциях (9:16, 1:1, 4:5, 16:9 и др.), поэтому все размеры считай от W и H (например, const u = Math.min(W, H) / 100), раскладку выбирай по соотношению W/H. Никаких абсолютных пикселей.
— duration, fps.
— assets[i] — материалы пользователя в порядке «Материал N»: { kind: 'image' | 'video' | 'audio', w, h, name, image }. image рисуй через cover() или ctx.drawImage. У видео image — уже нужный кадр в момент t (по meta.clips), просто рисуй его. У аудио image нет — его не рисуют, оно звучит через meta.music.
— Шрифты (все с кириллицей, вес 100–900): 'sans' — Inter, универсальный гротеск; 'geist' — Geist, технологичный; 'display' — Unbounded, широкий акцидентный для крупных заголовков; 'serif' — Playfair Display, премиальная антиква; 'mono' — JetBrains Mono. Указывай их в text({ font: 'display' }); для ctx.font есть строки семейств fonts.sans, fonts.display и т. д.
— Помощники:
  clamp(x, a = 0, b = 1); lerp(a, b, p); map(x, a, b, c, d) — с ограничением; prog(t, start, dur) → 0…1; pulse(t, start, dur) → 0…1…0
  ease.linear | inQuad | outQuad | inOutQuad | inCubic | outCubic | inOutCubic | inQuart | outQuart | inOutQuart | inExpo | outExpo | inOutExpo | inSine | outSine | inOutSine | inBack | outBack | inOutBack | outElastic | outBounce | spring(p, k = 8)
  rng(seed) → функция случайных чисел 0…1 (детерминированная); noise(x, y) → плавный шум −1…1
  hex('#ff6a00', 0.5) → 'rgba(…)'; mix(colorA, colorB, p) → цвет между ними
  rrect(ctx, x, y, w, h, r) — путь скруглённого прямоугольника (дальше ctx.fill(), ctx.stroke() или ctx.clip())
  text(ctx, str, x, y, { size, font, weight, italic, color, alpha, align: 'left' | 'center' | 'right', baseline, spacing (в em, можно отрицательный), maxWidth, lineHeight, stroke, strokeWidth }) — рисует, возвращает { width, height, lines }
  measure(ctx, str, opts) → ширина; wrap(ctx, str, maxWidth, opts) → массив строк
  cover(ctx, img, x, y, w, h, { zoom, fx, fy, alpha, radius }) — картинка или кадр видео заполняет прямоугольник (как object-fit: cover); zoom > 1 — наезд; fx, fy 0…1 — точка фокуса (для панорам)
  contain(ctx, img, x, y, w, h, { zoom, alpha })
— Всё из Canvas 2D: градиенты, clip-маски, globalCompositeOperation, трансформации, Path2D, тени. ctx.filter есть не во всех браузерах — только как необязательное украшение.

ЗАПРЕЩЕНО: сеть и fetch, import, DOM и document, таймеры, requestAnimationFrame, eval, бесконечные циклы, getImageData/putImageData, больше ~400 частиц в кадре. Кадр 1080p должен рисоваться быстрее ~25 мс.`;

const CODE_PROMPT = `Ты — сильный моушн-дизайнер и креативный кодер уровня студий, которые делают ролики для Apple, Stripe и Linear. Ты сам создаёшь рекламный ролик: пишешь код анимации на JavaScript для Canvas 2D. Код рисует любой кадр по времени t; движок вызывает его для каждого кадра и записывает видео. Никаких шаблонов: композиция, типографика, движение и переходы полностью твои.

${RUNTIME_API}

КАЧЕСТВО — главное: ролик должен выглядеть как работа сильной студии, а не как слайд-шоу.
— Идея и ритм: 4–8 сцен-битов, у каждой своя задача; монтажный ритм 0.4–0.8 с; первые 1–1.5 с цепляют; финал сильный (название, логотип, призыв).
— Типографика: крупные контрастные заголовки и ясная иерархия; кинетика — побуквенное или пословное появление со сдвигом (stagger 0.02–0.06 с), маски-проявления, трекинг, смена начертаний. Текст никогда не выходит за кадр: меряй через measure() или maxWidth и уменьшай кегль для узкого кадра.
— Движение: только плавные кривые (outExpo, inOutCubic; outBack для акцентов; spring для «живых» элементов), никакой линейной анимации позиций. У каждого элемента есть вход, жизнь (лёгкий дрейф, параллакс) и выход.
— Материалы пользователя — герои ролика: используй каждый и красиво кадрируй (cover с медленным наездом или панорамой, маски-фигуры, карточки со скруглением и тенью, сплит-экраны, коллажи). Видео-материалы показывай как видео.

МОНТАЖ ВИДЕО-МАТЕРИАЛОВ (если пользователь дал видео):
— Ты и моушн-дизайнер, и монтажёр. У каждого видео ниже есть длительность, сцены (склейки внутри видео) с динамикой, кадры с точным временем и где в нём явно слышен звук (речь или музыка). По ним выбери лучшие моменты и смонтируй их в ритм ролика.
— Видео — главный материал: показывай его крупно, на весь кадр или почти; графику и текст клади поверх, не закрывая главное.
— Каждый кусок — отдельная запись meta.clips: {"asset": номер, "start": с, "end": с, "from": с, "volume": 0…1}. start–end — когда кусок идёт в ролике; from — с какой секунды самого видео он начинается. Одно видео можно резать на сколько угодно кусков и ставить в любом порядке. from + (end − start) не больше длительности видео. Куски без пауз покрывают ролик там, где видно видео.
— В коде рисуй assets[номер].image в моменты его кусков: движок сам подставит нужный кадр.
— Звук: volume 1 — оставить живой звук видео (речь, атмосферу), 0 — без звука (под музыку), 0.3–0.6 — тихо под музыку. Не режь фразу посередине: границы кусков со звуком ставь в паузах, вне участков «слышно».
— Музыка: если есть аудио-материал, положи его под ролик — meta.music = {"asset": номер, "from": с какой секунды трека, "volume": 0.5–0.9}. Движок сам приглушит её под речью и сделает затухание в конце. Склейки ставь в ритм музыки.
— Если материалов больше, чем помещается в ролик заданной длины, выбери главное. О том, что пришлось сократить или что нельзя сделать как просили (видео намного длиннее ролика, материал плохого качества, нет логотипа или нужного текста), коротко напиши пользователю в meta.warnings — по-русски, одна-две фразы на пункт.
— Переходы авторские: шторки и маски из фигур, зум насквозь, свайп со следом движения (несколько полупрозрачных копий), вспышки, заливка цветом. Не просто растворение.
— Графика: геометрия, линии, сетки, градиентные пятна, частицы, свечение, зерно — осмысленно и под настроение бренда. Палитра 2–4 цвета из материалов или бренда. Текст всегда читается: контраст, подложки.
— Безопасные поля: важное держи в 6–8% от краёв кадра.
— Весь текст в кадре — на языке задачи пользователя (по умолчанию русский), коротко и по-рекламному. Не выдумывай цены, скидки, факты и обещания, которых нет в задаче.

Образец стиля кода (только как пример API, не копируй сцену):
const U = () => Math.min(W, H) / 100;
function words(ctx, str, x, y, start, t, o) {
  let cx = x;
  str.split(' ').forEach((w, i) => {
    const p = ease.outExpo(prog(t, start + i * 0.05, 0.7));
    text(ctx, w, cx, y + (1 - p) * o.size * 0.5, { ...o, alpha: p });
    cx += measure(ctx, w + ' ', o);
  });
}
function frame(ctx, t) {
  const u = U();
  if (t < 3) {
    cover(ctx, assets[0].image, 0, 0, W, H, { zoom: 1.18 - 0.12 * ease.outCubic(prog(t, 0, 3)) });
    ctx.fillStyle = hex('#000000', 0.35);
    ctx.fillRect(0, 0, W, H);
    words(ctx, 'Утро начинается здесь', 8 * u, H * 0.72, 0.3, t, { size: 9 * u, font: 'display', weight: 800, color: '#ffffff' });
  }
}

ФОРМАТ ОТВЕТА — строго два блока, без markdown и пояснений:
<meta>
{"title": "название идеи", "concept": "1–2 предложения: идея и почему сработает", "background": "#RRGGBB", "palette": ["#RRGGBB"], "beats": [{"start": 0, "end": 2.5, "text": "что происходит в кадре"}], "clips": [{"asset": 1, "start": 2.5, "end": 6, "from": 12.4, "volume": 1}], "music": {"asset": 2, "from": 0, "volume": 0.7}, "warnings": ["что пользователю стоит знать"]}
</meta>
<code>
function frame(ctx, t, env) { … }
</code>
beats — понятное пользователю описание сцен по времени, покрывают весь ролик. clips — куски видео-материалов (для фото не нужны). music и warnings — только если нужны. Код компактный и аккуратный: 200–400 строк, без длинных комментариев — ответ длиннее лимита обрезается и не заработает.`;

const FIX_PROMPT = `Ты — креативный кодер. Ниже код анимации рекламного ролика для Canvas 2D (движок ONEFLOW Motion Engine) и ошибка, которую он выдал при проверке. Исправь код, чтобы он работал во всех кадрах, сохранив идею, тексты, стиль и тайминг. Если ошибка — пустые или одноцветные кадры, сделай, чтобы во всех сценах было видно содержимое.

${RUNTIME_API}

ФОРМАТ ОТВЕТА — тот же, строго два блока без markdown: <meta>{…тот же JSON…}</meta> и <code>…весь исправленный код целиком…</code>`;

const MAX_CODE_CHARS = 150_000;
interface Composition {
  title: string;
  concept: string;
  duration: number;
  background: string;
  palette: string[];
  beats: { start: number; end: number; text: string }[];
  clips: { asset: number; start: number; end: number; from: number; volume: number }[];
  music: { asset: number; from: number; volume: number } | null;
  warnings: string[];
  code: string;
}

// The model's <meta> and <code> blocks → a composition the client can run. A cut-off answer (no
// closing </code>) is refused: half a function would only fail later in the browser.
function parseComposition(text: string, duration: number, materials: { kind: 'image' | 'video' | 'audio'; duration?: number }[], truncated: boolean): Composition {
  const kinds = materials.map((m) => m.kind);
  const metaText = /<meta>([\s\S]*?)<\/meta>/i.exec(text)?.[1] ?? '';
  const codeMatch = /<code>([\s\S]*?)<\/code>/i.exec(text);
  if (!codeMatch) {
    throw new GuardError(502, truncated ? 'too_long' : 'bad_answer', truncated ? 'Opus написал слишком длинный ответ и не уложился в лимит. Попробуйте ещё раз — деньги за эту попытку не списаны.' : 'Модель ответила не в том формате. Попробуйте ещё раз.');
  }
  const code = codeMatch[1].replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '').trim();
  if (!/\bfunction\s+frame\s*\(|\bframe\s*=\s*(?:function\b|\()/.test(code)) throw new GuardError(502, 'bad_answer', 'В ответе модели нет функции кадра. Попробуйте ещё раз.');
  if (code.length > MAX_CODE_CHARS) throw new GuardError(502, 'bad_answer', 'Модель написала слишком длинный код. Попробуйте ещё раз.');
  let meta: any = {};
  try {
    meta = metaText ? extractJson(metaText) : {};
  } catch {
    meta = {};
  }
  const time = (v: unknown) => Math.round(Math.max(0, Math.min(duration, Number(v) || 0)) * 100) / 100;
  const beats = (Array.isArray(meta?.beats) ? meta.beats : [])
    .slice(0, 24)
    .map((b: any) => ({ start: time(b?.start), end: time(b?.end), text: str(b?.text, 200) }))
    .filter((b: { start: number; end: number; text: string }) => b.text && b.end > b.start);
  const volume = (v: unknown, def: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Math.max(0, Math.min(1, Number(v))) * 100) / 100 : def);
  // a cut starting past the end of its video starts at its last second instead
  const within = (asset: number, from: number) => {
    const d = materials[asset]?.duration;
    return Math.round((d && d > 0.2 ? Math.min(from, Math.max(0, d - 0.2)) : from) * 100) / 100;
  };
  const clips = (Array.isArray(meta?.clips) ? meta.clips : [])
    .slice(0, 64)
    .map((c: any) => ({ asset: Number(c?.asset), start: time(c?.start), end: time(c?.end), from: Math.max(0, Math.min(3600, Number(c?.from) || 0)), volume: volume(c?.volume, 1) }))
    .filter((c: { asset: number; start: number; end: number }) => Number.isInteger(c.asset) && kinds[c.asset] === 'video' && c.end > c.start)
    .map((c: { asset: number; from: number }) => ({ ...c, from: within(c.asset, c.from) }));
  const m = meta?.music;
  const musicAsset = Number(m?.asset);
  const music = m && Number.isInteger(musicAsset) && kinds[musicAsset] === 'audio'
    ? { asset: musicAsset, from: within(musicAsset, Math.max(0, Number(m.from) || 0)), volume: volume(m.volume, 0.8) }
    : null;
  const warnings = (Array.isArray(meta?.warnings) ? meta.warnings : []).map((w: unknown) => str(w, 240)).filter(Boolean).slice(0, 6);
  return {
    title: str(meta?.title, 80) || 'Ролик',
    concept: str(meta?.concept, 400),
    duration,
    background: hex(meta?.background, '#0b0b0f'),
    palette: (Array.isArray(meta?.palette) ? meta.palette : []).map((c: unknown) => hex(c, '')).filter(Boolean).slice(0, 6),
    beats,
    clips,
    music,
    warnings,
    code,
  };
}

type Shot = { start: number; dur: number; motion: number };
type AssetIn = {
  kind: 'image' | 'video' | 'audio';
  name: string;
  duration?: number;
  frames: string[];
  // video materials, as the browser found them (src/motion/footage.ts): when each frame is, the
  // shots, where the sound is clearly audible
  frameTimes?: number[];
  width?: number;
  height?: number;
  shots?: Shot[];
  audio?: { has: boolean; loud: [number, number][] };
};
type Reference = { kind: 'video' | 'images'; duration: number; shots: { start: number; dur: number; motion: number }[]; palette: string[]; frames: string[]; frameShots: number[] };

function normAsset(a: any, maxFrames: number): AssetIn {
  const num = (v: unknown, max: number) => Math.round(Math.max(0, Math.min(max, Number(v) || 0)) * 100) / 100;
  const kind = a?.kind === 'video' ? 'video' : a?.kind === 'audio' ? 'audio' : 'image';
  const frames: string[] = [];
  const frameTimes: number[] = [];
  (Array.isArray(a?.frames) ? a.frames : []).forEach((f: unknown, i: number) => {
    if (kind === 'audio' || frames.length >= maxFrames || typeof f !== 'string' || !f.startsWith('data:image/') || f.length > MAX_FRAME_CHARS) return;
    frames.push(f);
    frameTimes.push(Array.isArray(a?.frameTimes) ? num(a.frameTimes[i], 3600) : NaN);
  });
  const out: AssetIn = { kind, name: String(a?.name ?? '').slice(0, 80), duration: Number(a?.duration) || undefined, frames };
  if (Number(a?.width) > 0 && Number(a?.height) > 0) Object.assign(out, { width: Math.round(Number(a.width)), height: Math.round(Number(a.height)) });
  if (kind !== 'video') return out;
  if (frameTimes.some((t) => Number.isFinite(t))) out.frameTimes = frameTimes;
  if (Array.isArray(a?.shots)) out.shots = a.shots.slice(0, 30).map((x: any) => ({ start: num(x?.start, 3600), dur: num(x?.dur, 3600), motion: num(x?.motion, 1) }));
  if (a?.audio && typeof a.audio === 'object') {
    out.audio = {
      has: Boolean(a.audio.has),
      loud: (Array.isArray(a.audio.loud) ? a.audio.loud : []).slice(0, 40).map((r: any) => [num(r?.[0], 3600), num(r?.[1], 3600)] as [number, number]).filter(([x, y]: [number, number]) => y > x),
    };
  }
  return out;
}

function normReference(raw: any): Reference | null {
  if (!raw || typeof raw !== 'object') return null;
  const frames = (Array.isArray(raw.frames) ? raw.frames : [])
    .filter((f: unknown) => typeof f === 'string' && f.startsWith('data:image/') && f.length <= MAX_FRAME_CHARS)
    .slice(0, MAX_REF_FRAMES);
  if (!frames.length) return null;
  const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Number(v) || 0));
  return {
    kind: raw.kind === 'video' ? 'video' : 'images',
    duration: num(raw.duration, 600),
    shots: (Array.isArray(raw.shots) ? raw.shots : []).slice(0, MAX_REF_SHOTS).map((x: any) => ({ start: num(x?.start, 600), dur: num(x?.dur, 600), motion: num(x?.motion, 1) })),
    palette: (Array.isArray(raw.palette) ? raw.palette : []).map((c: unknown) => hex(c, '')).filter(Boolean).slice(0, 8),
    frames,
    frameShots: (Array.isArray(raw.frameShots) ? raw.frameShots : []).map((v: unknown) => Math.round(num(v, MAX_REF_SHOTS))).slice(0, frames.length),
  };
}

const pace = (m: number) => (m < 0.02 ? 'спокойная' : m < 0.05 ? 'средняя' : 'высокая');

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

// ---- Spend guard v2 — generated from supabase/functions/_shared/paid_guard.ts by
// scripts/sync-edge-guard.mjs. Edit that file and re-run the script; do not edit this copy by hand
// (every paid function deploys as one pasted file, so the block is copied into each of them).
//
// Every paid call goes through reserve_generation_v2 (supabase/migrations/202610090001_security_
// hardening.sql) BEFORE the provider is called. That one database call checks the kill switch,
// e-mail confirmation, the single-job ceiling, the Idempotency-Key, per-account and per-IP rates,
// parallel jobs, the global / per-account / organisation spend caps and the credits. After the call
// the reservation is settled with the real cost (once), or released if the provider failed.
// Refusals map to stable codes the app translates (src/webApi.ts callFunction).
class GuardError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}
const GUARD_ERRORS: Record<string, [number, string]> = {
  email_not_confirmed: [403, 'Подтвердите email, чтобы пользоваться генерацией.'],
  quota_exceeded: [402, 'Недостаточно кредитов — пополните баланс.'],
  too_many_jobs: [429, 'Слишком много генераций одновременно — дождитесь завершения.'],
  job_too_expensive: [400, 'Запрос слишком дорогой для одной генерации.'],
  rate_limited: [429, 'Слишком много запросов. Подождите минуту.'],
  spend_limit: [429, 'Достигнут лимит расходов. Попробуйте позже.'],
  service_paused: [503, 'Генерация временно приостановлена. Попробуйте позже.'],
  account_blocked: [403, 'Генерация для этого аккаунта приостановлена. Напишите в поддержку.'],
  bad_idempotency_key: [400, 'Bad request.'],
  bad_amount: [400, 'Bad request.'],
};
const badRequest = (message: string) => new GuardError(400, 'bad_request', message);

// Request bodies carry reference images as data URLs, so the ceiling is generous but finite.
const MAX_BODY_BYTES = 48 * 1024 * 1024;
async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, any>> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new GuardError(413, 'payload_too_large', 'Запрос слишком большой.');
  const text = await req.text().catch(() => '');
  if (text.length > maxBytes) throw new GuardError(413, 'payload_too_large', 'Запрос слишком большой.');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fall through
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw badRequest('Bad request.');
  return parsed as Record<string, any>;
}

// The client address as seen by the platform proxy. cf-connecting-ip / x-real-ip are set by the
// proxy itself; in x-forwarded-for only the LAST hop was added by the proxy (anything before it can
// be typed by the client), so that is the one used. Stored only as a salted hash.
async function clientIpHash(req: Request): Promise<string | null> {
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? xff[xff.length - 1] ?? '';
  if (!ip || ip.length > 64) return null;
  const salt = Deno.env.get('IP_HASH_SALT') ?? Deno.env.get('SUPABASE_URL') ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return Array.from(new Uint8Array(digest).slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Optional Idempotency-Key header (src/webApi.ts sends one per call): a retried request with the
// same key never starts a second paid job.
function idempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key');
  if (!key) return null;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw badRequest('Bad Idempotency-Key.');
  return key;
}

// Spend alerts are journaled in security_events by the database; this only pings an optional
// webhook (ALERT_WEBHOOK_URL, e.g. a Slack/Telegram relay) with no user data and no secrets.
function notifyAlert(kind: string, fn: string): void {
  const url = Deno.env.get('ALERT_WEBHOOK_URL') ?? '';
  if (!url.startsWith('https://')) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `ONEFLOW spend alert: ${kind} (function ${fn}). See security_events.` }),
  }).catch(() => {});
}

const functionName = (req: Request) => new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? 'unknown';

// A refusal for money says how much: the request's price, what is free now and what running
// generations hold (credits, 1 credit = $0.01 of model cost). Accounts with a monthly dollar
// allowance (generation_overrides) hit that allowance instead: { limit: 'monthly' }.
async function quotaDetails(userId: string, amountUsd: number): Promise<Record<string, unknown>> {
  const needed = Math.max(0, Math.ceil(Math.max(0, Number(amountUsd) || 0) * 100 - 1e-9));
  const { data, error } = await supabaseAdmin.rpc('credit_balance', { p_user: userId });
  const b = Array.isArray(data) ? data[0] : data;
  if (error || !b) return { needed };
  if (b.unlimited) return { needed, limit: 'monthly' };
  const reserved = Math.max(0, Number(b.reserved) || 0);
  return { needed, available: Math.max(0, (Number(b.available) || 0) - reserved), reserved };
}

async function reserveSpend(req: Request, userId: string, model: string, category: string, amountUsd: number): Promise<string> {
  const fn = functionName(req);
  const { data, error } = await supabaseAdmin.rpc('reserve_generation_v2', {
    p_user: userId,
    p_model: model,
    p_category: category,
    p_amount: Math.max(0, Number(amountUsd) || 0),
    p_idempotency_key: idempotencyKey(req),
    p_function: fn,
    p_ip_hash: await clientIpHash(req),
  });
  // Fail closed: if the gate itself is unavailable, nothing paid runs.
  if (error || !data || typeof data !== 'object') {
    console.error('reserve_generation_v2 failed', error);
    throw new GuardError(503, 'guard_unavailable', 'Сервис временно недоступен. Попробуйте позже.');
  }
  const r = data as { id?: string; replay?: boolean; status?: string; error?: string; retry_after?: number; alert?: string };
  if (r.error) {
    const [status, message] = GUARD_ERRORS[r.error] ?? [400, 'Bad request.'];
    const extra: Record<string, unknown> = r.retry_after ? { retryAfter: r.retry_after } : {};
    if (r.error === 'quota_exceeded') Object.assign(extra, await quotaDetails(userId, amountUsd));
    throw new GuardError(status, r.error, message, extra);
  }
  if (r.replay) {
    throw new GuardError(409, 'duplicate_request', 'Этот запрос уже выполняется или выполнен.', { jobId: r.id, jobStatus: r.status });
  }
  if (r.alert) notifyAlert(r.alert, fn);
  return r.id as string;
}

async function settleSpend(reservation: string | null, email: string, costUsd: number | null, result: unknown = null): Promise<void> {
  if (!reservation) return;
  const cost = Number.isFinite(costUsd) && (costUsd as number) >= 0 ? costUsd : null;
  const { error } = await supabaseAdmin.rpc('settle_generation', { p_reservation: reservation, p_email: email, p_cost: cost, p_result: result });
  if (error) console.error('settle_generation failed', error);
}

// Async provider jobs (video): once the provider accepted the job it bills us, so the budget is held
// until the job resolves — the reservation is never auto-released after this point.
async function markSubmitted(reservation: string, providerJobId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('mark_generation_submitted', { p_reservation: reservation, p_provider_job: providerJobId });
  if (error) console.error('mark_generation_submitted failed', error);
}

// Generic distributed limiter (rate_limit_hit in Postgres, shared by every function instance).
// Throws 429 with Retry-After when over the limit. failClosed: a broken limiter refuses the request
// (paid paths) instead of letting it through (cheap, read-only paths log and continue).
async function rateLimit(bucket: string, limit: number, windowSeconds: number, failClosed: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('rate_limit_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error('rate_limit_hit failed', error);
    if (failClosed) throw new GuardError(503, 'guard_unavailable', 'Сервис временно недоступен. Попробуйте позже.');
    return;
  }
  if (Number(data) > 0) throw new GuardError(429, 'rate_limited', GUARD_ERRORS.rate_limited[1], { retryAfter: Number(data) });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface OwnedJob { id: string; status: string; provider_job_id: string | null; amount_usd: number; result: unknown; model: string }
// A job is only ever visible to the account that started it (the id alone grants nothing).
async function loadOwnedJob(userId: string, jobId: unknown): Promise<OwnedJob | null> {
  if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) return null;
  const { data, error } = await supabaseAdmin
    .from('generation_reservations')
    .select('id, status, provider_job_id, amount_usd, result, model')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as OwnedJob | null) ?? null;
}

// Releases an unsettled reservation and turns any error into a response without internal details
// (the details go to the function logs).
async function failResponse(err: unknown, reservation: string | null, message: string): Promise<Response> {
  if (reservation) {
    const { error } = await supabaseAdmin.rpc('release_generation', { p_reservation: reservation });
    if (error) console.error('release_generation failed', error);
  }
  if (err instanceof GuardError) {
    const headers: Record<string, string> = {};
    if (typeof err.extra.retryAfter === 'number') headers['Retry-After'] = String(err.extra.retryAfter);
    const { retryAfter: _r, ...rest } = err.extra;
    return jsonResponse({ error: err.message, code: err.code, ...rest }, err.status, headers);
  }
  console.error(err);
  return jsonResponse({ error: message }, 500);
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

// Reference media handed to providers: image data URLs, or https URLs that point at a public host —
// never credentials in the URL, an IP literal, localhost, a private/link-local/metadata range or an
// internal name. Providers fetch these, not us, but they must not be steerable at internal targets.
const MAX_IMAGE_REF_CHARS = 12_000_000;
function isPublicHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 4096) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) return false;
  if (host === 'metadata.google.internal' || host.endsWith('.svc') || host.endsWith('.cluster.local')) return false;
  return true;
}
const isImageRef = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_IMAGE_REF_CHARS && (v.startsWith('data:image/') || isPublicHttpsUrl(v));
const isMediaRef = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_IMAGE_REF_CHARS && (/^data:(image|video|audio)\//.test(v) || isPublicHttpsUrl(v));
const clipText = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const validRatio = (v: unknown, fallback: string): string => (typeof v === 'string' && /^\d{1,2}:\d{1,2}$/.test(v) ? v : fallback);
// Provider calls never hang the function: every fetch to a provider has a deadline.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
// ---- end of spend guard

// ---- mode 'code' / 'fix'
// Claude Opus 5.5 always thinks first (adaptive thinking, it cannot be turned off) and max_tokens
// caps thinking + answer together. A new video is written at effort 'high' (the owner's choice: think
// it through), with the 64k Anthropic advises for that; at 'medium' an answer took ~20k of thinking
// + ~15–20k of code in 5–6 minutes. A fix is narrower: 'medium'.
const CODE_SETTINGS = { effort: 'high', maxTokens: 64_000, deadlineMs: 900_000 };
const FIX_SETTINGS = { effort: 'medium', maxTokens: 40_000, deadlineMs: 600_000 };
const CODE_RESERVE_USD = 1.6; // worst case 64k out + pictures in; settled with the real cost
const FIX_RESERVE_USD = 0.9;
// pictures Opus gets of the materials: up to 8 keyframes per video, 1 per photo
const CODE_MAX_FRAMES = 40;

const FONT_NAMES: Record<string, string> = { sans: 'Inter', display: 'Unbounded', serif: 'Playfair Display', mono: 'JetBrains Mono' };
const PACE_NAMES: Record<string, string> = { calm: 'спокойный', medium: 'средний', fast: 'быстрый' };

// ---- background jobs. Opus writes for minutes; a request held open that long was cut somewhere on
// the way (the runtime's 150 s idle timeout, a proxy, a browser tab put to sleep) and the app got an
// empty answer. So the call starts the job and answers 202 at once; the job keeps the worker alive
// (EdgeRuntime.waitUntil) and leaves its outcome on the reservation: the composition (code gzipped,
// settle_generation keeps up to 64 KB) or the reason it failed. Polls read it from there.
// past the 15-minute deadline, before the database's own 20-minute expiry: the worker is gone
// (deploy/selfhost/functions-main gives this function's worker 17 minutes)
const JOB_STALE_MS = 18 * 60_000;
const MAX_RESULT_CHARS = 60_000;

function inBackground(job: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === 'function') rt.waitUntil(job);
  else job.catch(() => undefined);
}

async function gzipBase64(text: string): Promise<string> {
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gunzipBase64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

// The reason a job failed, kept on its reservation for the poller, then the reservation released.
async function failJob(reservation: string, err: unknown): Promise<void> {
  const reason = err instanceof GuardError
    ? { error: err.message, code: err.code }
    : { error: 'Не удалось создать анимацию. Попробуйте ещё раз — деньги не списаны.', code: 'job_failed' };
  if (!(err instanceof GuardError)) console.error(err);
  const { error } = await supabaseAdmin.from('generation_reservations').update({ result: reason }).eq('id', reservation).eq('status', 'pending');
  if (error) console.error('job reason not kept', error);
  const { error: releaseError } = await supabaseAdmin.rpc('release_generation', { p_reservation: reservation });
  if (releaseError) console.error('release_generation failed', releaseError);
}

async function runCodeJob(reservation: string, email: string, work: () => Promise<{ composition: Composition; costUsd: number }>): Promise<void> {
  try {
    const { composition, costUsd } = await work();
    const { code, ...rest } = composition;
    const result = { composition: { ...rest, codeGz: await gzipBase64(code) }, costUsd };
    if (JSON.stringify(result).length > MAX_RESULT_CHARS) throw new GuardError(502, 'too_long', 'Opus написал слишком большой код. Попробуйте ещё раз — деньги за эту попытку не списаны.');
    await settleSpend(reservation, email, costUsd, result);
  } catch (err) {
    await failJob(reservation, err);
  }
}

function startCodeJob(reservation: string, email: string, work: () => Promise<{ composition: Composition; costUsd: number }>): Response {
  inBackground(runCodeJob(reservation, email, work));
  return json({ pending: true, jobId: reservation }, 202);
}

// A poll: { jobId } of a job this account started.
async function resumeCodeJob(caller: { id: string }, jobId: unknown): Promise<Response> {
  await rateLimit(`motion-poll:${caller.id}`, 120, 60, false);
  const job = await loadOwnedJob(caller.id, jobId);
  if (!job || job.model !== MODEL_LABEL) return json({ error: 'Задача не найдена.', code: 'not_found' }, 404);
  const r = (job.result ?? {}) as { composition?: Record<string, unknown> & { codeGz?: string }; costUsd?: number; error?: string; code?: string };
  if (job.status === 'settled') {
    if (!r.composition || typeof r.composition.codeGz !== 'string') return json({ error: 'Результат больше недоступен. Создайте ролик ещё раз.', code: 'job_gone' }, 410);
    const { codeGz, ...rest } = r.composition;
    return json({ composition: { ...rest, code: await gunzipBase64(codeGz) }, costUsd: Number(r.costUsd) || 0 });
  }
  if (job.status === 'released' || job.status === 'expired') {
    return json({ error: r.error ?? 'Не удалось создать анимацию. Попробуйте ещё раз — деньги не списаны.', code: r.code ?? 'job_failed' }, 502);
  }
  const { data } = await supabaseAdmin.from('generation_reservations').select('created_at').eq('id', job.id).maybeSingle();
  const created = Date.parse(String((data as { created_at?: string } | null)?.created_at ?? ''));
  if (Number.isFinite(created) && Date.now() - created > JOB_STALE_MS) {
    const lost = new GuardError(502, 'job_lost', 'Сервер прервал работу над анимацией. Попробуйте ещё раз — деньги не списаны.');
    await failJob(job.id, lost);
    return json({ error: lost.message, code: lost.code }, 502);
  }
  return json({ pending: true, jobId: job.id }, 202);
}

type Materials = { kind: 'image' | 'video' | 'audio'; duration?: number }[];

// No temperature: with thinking on, Anthropic only takes the default.
async function askForCode(system: string, content: unknown, materials: Materials, duration: number, settings: typeof CODE_SETTINGS) {
  const started = Date.now();
  const res = await fetchWithTimeout(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
      max_tokens: settings.maxTokens,
      reasoning: { effort: settings.effort, exclude: true },
      usage: { include: true },
    }),
  }, settings.deadlineMs);
  if (!res.ok) {
    // links in OpenRouter's errors point at the account's key: not for the logs
    console.error('OpenRouter error', res.status, (await res.text()).replace(/https?:\/\/\S+/g, '[link]').slice(0, 500));
    if (res.status === 402) {
      notifyAlert('openrouter_balance_empty', 'motion-storyboard');
      throw new GuardError(503, 'provider_unavailable', 'Генерация временно недоступна. Попробуйте позже — деньги не списаны.');
    }
    throw new GuardError(502, 'provider_error', 'Не удалось получить ответ от модели. Попробуйте ещё раз.');
  }
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? {};
  const costUsd = Number(usage.cost) || (Number(usage.prompt_tokens) || 0) * PRICE_IN + (Number(usage.completion_tokens) || 0) * PRICE_OUT;
  const finish = data.choices?.[0]?.finish_reason ?? null;
  // sizes and timing only (no content): what to look at when an answer comes back cut off or slow
  console.log('motion code', JSON.stringify({
    finish,
    seconds: Math.round((Date.now() - started) / 1000),
    completion: usage.completion_tokens ?? null,
    reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null,
    chars: text.length,
    cost: Number(usage.cost) || null,
  }));
  const composition = parseComposition(text, duration, materials, finish === 'length');
  return { composition, costUsd };
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const span = ([a, b]: [number, number]) => `${a.toFixed(1)}–${b.toFixed(1)} с`;

// One material in words for the prompt: what it is, and for a video everything needed to edit it.
function describeMaterial(a: AssetIn, i: number): string {
  const size = a.width && a.height ? `, ${a.width}×${a.height} (${a.width > a.height ? 'горизонтальное' : a.width < a.height ? 'вертикальное' : 'квадратное'})` : '';
  if (a.kind === 'audio') return `Материал ${i}: аудио «${a.name}»${a.duration ? `, ${mmss(a.duration)}` : ''} — музыка или звук: можно положить под ролик через meta.music.`;
  if (a.kind === 'image') return `Материал ${i}: фото «${a.name}»${size}.`;
  const parts = [`Материал ${i}: видео «${a.name}»${a.duration ? `, ${mmss(a.duration)} (${a.duration.toFixed(1)} с)` : ''}${size}.`];
  if (a.audio) {
    parts.push(
      !a.audio.has
        ? 'Звука нет.'
        : a.audio.loud.length
          ? `Звук есть; явно слышно (речь или музыка): ${a.audio.loud.map(span).join(', ')}.`
          : 'Звук есть, но тихий.'
    );
  }
  if (a.shots?.length) {
    parts.push(`Сцены внутри видео: ${a.shots.map((x, k) => `${k + 1}) ${x.start.toFixed(1)}–${(x.start + x.dur).toFixed(1)} с, динамика ${pace(x.motion)}`).join('; ')}.`);
  }
  if (a.frames.length) parts.push(`Кадры этого видео ниже${a.frameTimes?.some((t) => Number.isFinite(t)) ? ', у каждого — его секунда' : ''}.`);
  return parts.join(' ');
}

type Pinned = ReturnType<typeof normDirection> | null;

async function composeCode(
  req: Request,
  caller: { id: string; email: string },
  o: { brief: string; duration: number; aspect: string; assets: AssetIn[]; previous: string[]; pinned: Pinned; reference: Reference | null }
): Promise<Response> {
  const [w, h] = o.aspect.split(':').map(Number);
  const orientation = w > h ? 'горизонтальный' : w < h ? 'вертикальный' : 'квадратный';
  const footage = o.assets.filter((a) => a.kind === 'video').reduce((sum, a) => sum + (a.duration ?? 0), 0);
  const lines = [
    `Задача пользователя: ${o.brief || '(не указана — придумай по материалам)'}`,
    `Длительность ролика: ${o.duration} с. Основной формат кадра: ${o.aspect} (${orientation}); код должен хорошо выглядеть и в других пропорциях.`,
    o.assets.length
      ? `Материалов: ${o.assets.length} — ${o.assets.map((a, i) => `${i}: ${a.kind === 'video' ? 'видео' : a.kind === 'audio' ? 'аудио' : 'фото'}`).join(', ')}.`
      : 'Материалов нет — ролик только из типографики и графики.',
    footage > o.duration * 1.5 ? `Видео в сумме ${mmss(footage)} — намного больше ролика: смонтируй лучшие моменты и напиши в meta.warnings, что взял.` : '',
  ];
  if (o.pinned) {
    const p = o.pinned;
    lines.push(
      `Пользователь выбрал стиль «${p.name}»: ${p.description} Палитра: фон ${p.style.bg}, текст ${p.style.ink}, акцент ${p.style.accent}; шрифт — ${FONT_NAMES[p.style.font] ?? 'Inter'}; темп — ${PACE_NAMES[p.pace] ?? 'средний'}${p.style.fx.length ? `; фактура: ${p.style.fx.join(', ')}` : ''}. Держись этого стиля.`
    );
  }
  const ref = o.reference;
  if (ref) {
    lines.push(
      'РЕФЕРЕНС: пользователь хочет ролик «как этот» — повтори его подачу своими средствами, но с материалами и текстами пользователя. Сам референс в ролик не попадает; его тексты, логотипы и бренд не копируй.',
      ref.kind === 'video'
        ? `Референс — видео ${ref.duration.toFixed(1)} с, ${ref.shots.length} сцен: ${ref.shots.map((x, i) => `${i + 1}) ${x.dur.toFixed(1)} с, динамика ${pace(x.motion)}`).join('; ')}. Сделай похожий монтаж: столько же сцен (не больше 20), те же пропорции длительностей (подгони к ${o.duration} с), похожая динамика и подача текста.`
        : `Референс — ${ref.frames.length} картинк(и): повтори их композицию, типографику и настроение.`,
      ref.palette.length ? `Палитра референса: ${ref.palette.join(', ')}.` : ''
    );
  }
  if (o.previous.length) lines.push(`Уже сделанные варианты (придумай заметно другой ролик):\n- ${o.previous.join('\n- ')}`);

  const content: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] = [{ type: 'text', text: lines.filter(Boolean).join('\n') }];
  let budget = CODE_MAX_FRAMES;
  o.assets.forEach((a, i) => {
    content.push({ type: 'text', text: describeMaterial(a, i) });
    a.frames.forEach((f, k) => {
      if (budget-- <= 0) return;
      const t = a.frameTimes?.[k];
      if (a.kind === 'video' && Number.isFinite(t)) content.push({ type: 'text', text: `Материал ${i}, кадр на ${(t as number).toFixed(1)} с:` });
      content.push({ type: 'image_url', image_url: { url: f } });
    });
  });
  ref?.frames.forEach((f, i) => {
    const k = ref.frameShots[i];
    const shot = ref.shots[k];
    content.push({ type: 'text', text: shot ? `Кадр референса — сцена ${k + 1} (${shot.start.toFixed(1)}–${(shot.start + shot.dur).toFixed(1)} с)` : `Картинка-референс ${i + 1}` });
    content.push({ type: 'image_url', image_url: { url: f } });
  });

  const reservation = await reserveSpend(req, caller.id, MODEL_LABEL, 'motion', CODE_RESERVE_USD);
  const materials = o.assets.map((a) => ({ kind: a.kind, duration: a.duration }));
  return startCodeJob(reservation, caller.email, () => askForCode(CODE_PROMPT, content, materials, o.duration, CODE_SETTINGS));
}

// The browser ran the code and it failed (an exception, a frame that never came back, blank frames):
// Opus gets its own code and the error and returns the whole corrected composition.
async function fixCode(req: Request, caller: { id: string; email: string }, body: Record<string, any>): Promise<Response> {
  const c = body.composition && typeof body.composition === 'object' ? body.composition : {};
  const code = typeof c.code === 'string' ? c.code : '';
  if (!code || code.length > MAX_CODE_CHARS) return json({ error: 'Нечего исправлять.', code: 'bad_request' }, 400);
  const error = clipText(body.error, 2000) || 'неизвестная ошибка';
  const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(Number(body.duration) || Number(c.duration) || 15)));
  const aspect = validRatio(body.aspect, '16:9');
  const assets = (Array.isArray(body.assets) ? body.assets : []).slice(0, MAX_ASSETS).map((a: any) => ({
    kind: a?.kind === 'video' ? ('video' as const) : a?.kind === 'audio' ? ('audio' as const) : ('image' as const),
    name: String(a?.name ?? '').slice(0, 80),
    duration: Number(a?.duration) || undefined,
  }));
  const meta = {
    title: str(c.title, 80),
    concept: str(c.concept, 400),
    background: hex(c.background, '#0b0b0f'),
    palette: (Array.isArray(c.palette) ? c.palette : []).map((x: unknown) => hex(x, '')).filter(Boolean).slice(0, 6),
    beats: (Array.isArray(c.beats) ? c.beats : []).slice(0, 24),
    clips: (Array.isArray(c.clips) ? c.clips : []).slice(0, 64),
    music: c.music && typeof c.music === 'object' ? c.music : null,
    warnings: (Array.isArray(c.warnings) ? c.warnings : []).slice(0, 6),
  };
  const text = [
    `Задача пользователя: ${clipText(body.brief, MAX_BRIEF) || '(не указана)'}`,
    `Длительность: ${duration} с. Формат кадра: ${aspect}.`,
    assets.length
      ? `Материалы: ${assets.map((a: { kind: string; duration?: number }, i: number) => `${i}: ${a.kind === 'video' ? 'видео' : a.kind === 'audio' ? 'аудио' : 'фото'}${a.duration ? ` ${a.duration.toFixed(1)} с` : ''}`).join(', ')}.`
      : 'Материалов нет.',
    `Ошибка при проверке: ${error}`,
    '',
    `<meta>${JSON.stringify(meta)}</meta>`,
    `<code>\n${code}\n</code>`,
  ].join('\n');
  const reservation = await reserveSpend(req, caller.id, MODEL_LABEL, 'motion', FIX_RESERVE_USD);
  return startCodeJob(reservation, caller.email, () => askForCode(FIX_PROMPT, text, assets, duration, FIX_SETTINGS));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let reservation: string | null = null;
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: 'Not authenticated.' }, 401);
    if (!OPENROUTER_API_KEY) return json({ error: 'OPENROUTER_API_KEY is not configured.' }, 500);

    const body = await readJsonBody(req);
    if (body.jobId !== undefined) return await resumeCodeJob(caller, body.jobId);
    if (body.mode === 'fix') return await fixCode(req, caller, body);
    const mode = body.mode === 'styles' ? 'styles' : body.mode === 'code' ? 'code' : 'storyboard';
    const brief = typeof body.brief === 'string' ? body.brief.trim().slice(0, MAX_BRIEF) : '';
    const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(Number(body.duration) || 15)));
    const aspect = typeof body.aspect === 'string' && /^\d{1,2}:\d{1,2}$/.test(body.aspect) ? body.aspect : '16:9';
    const assets: AssetIn[] = (Array.isArray(body.assets) ? body.assets : []).slice(0, MAX_ASSETS).map((a: any) => normAsset(a, mode === 'code' ? 8 : 3));
    const previous: string[] = (Array.isArray(body.previous) ? body.previous : []).filter((p: unknown) => typeof p === 'string').slice(-12).map((p: string) => p.slice(0, 300));
    const pinned = (mode === 'storyboard' || mode === 'code') && body.style && typeof body.style === 'object' ? normDirection(body.style, 0) : null;
    if (pinned) pinned.name = str(body.style.name, 40) || pinned.name;
    const reference = normReference(body.reference);
    if (!brief && !assets.length) return json({ error: 'Добавьте материалы или опишите задачу.' }, 400);
    if (mode === 'code') return await composeCode(req, caller, { brief, duration, aspect, assets, previous, pinned, reference });

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
    if (reference) {
      const shots = reference.shots;
      lines.push(
        `РЕФЕРЕНС: пользователь хочет ролик «как этот». Повтори его ${reference.kind === 'video' ? 'монтаж и стиль' : 'стиль'} средствами движка, но с материалами и текстами пользователя. ` +
          'Сам референс в ролик не попадает; не копируй его тексты, логотипы и бренд.',
        reference.kind === 'video'
          ? `Референс — видео ${reference.duration.toFixed(1)} с, ${shots.length} сцен (склеек). Сцены: ${shots.map((x, i) => `${i + 1}) ${x.dur.toFixed(1)} с, динамика ${pace(x.motion)}`).join('; ')}.`
          : `Референс — ${reference.frames.length} картинк(и) со стилем, без монтажа.`,
        reference.palette.length ? `Палитра референса: ${reference.palette.join(', ')}.` : '',
        reference.kind === 'video'
          ? `Сделай столько же сцен (не больше 20) и сохрани соотношение их длительностей — пропорционально подгони к длительности ролика ${duration} с. Для каждой сцены выбери layout, camera, textAnim и transition, максимально похожие на то, что видно на кадре соответствующей сцены референса; сценам с высокой динамикой — активная камера и резкие переходы, спокойным — медленные.`
          : 'Повтори композицию, подачу текста и настроение картинок.',
        pinned
          ? 'Внешний вид (цвета, шрифт, эффекты) бери из выбранного стиля выше, от референса — ритм, структуру и подачу.'
          : 'Внешний вид (цвета style.bg/ink/accent, font, fx) подбери по референсу, чтобы ролик выглядел как он.'
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
    reference?.frames.forEach((f, i) => {
      const k = reference.frameShots[i];
      const shot = reference.shots[k];
      content.push({ type: 'text', text: shot ? `Кадр референса — сцена ${k + 1} (${shot.start.toFixed(1)}–${(shot.start + shot.dur).toFixed(1)} с)` : `Картинка-референс ${i + 1}` });
      content.push({ type: 'image_url', image_url: { url: f } });
    });

    // worst case for this request size (max_tokens below + up to ~30 frames in); settled with the real cost
    reservation = await reserveSpend(req, caller.id, MODEL_LABEL, 'motion', mode === 'styles' ? 0.15 : 0.35);
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: mode === 'styles' ? STYLES_PROMPT : STORYBOARD_PROMPT }, { role: 'user', content }],
        // Opus 5.5 always thinks first and the limit covers the thinking too
        max_tokens: mode === 'styles' ? 12_000 : 16_000,
        temperature: mode === 'styles' || previous.length ? 1 : 0.8,
        reasoning: { effort: 'low', exclude: true },
        usage: { include: true },
      }),
    });
    if (!res.ok) {
      console.error('OpenRouter error', res.status, await res.text());
      return failResponse(new GuardError(502, 'provider_error', 'Не удалось получить ответ от модели. Попробуйте ещё раз.'), reservation, '');
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

    await settleSpend(reservation, caller.email, costUsd);
    reservation = null;

    return json({ ...result, costUsd });
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  }
});
