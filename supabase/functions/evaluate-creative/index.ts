// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "evaluate-creative" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY (Edge Functions → evaluate-creative → Secrets;
// openrouter.ai/settings/keys).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// This is a heuristic design-quality read on an ad creative, not a statistical CTR
// prediction — no model here has real impression/click data to calibrate a percentage
// against, so the system prompt below deliberately asks for a 1-10 score plus concrete
// strengths/weaknesses instead of inventing a plausible-looking number. Comparing 2-3
// variants against each other (relative judgment) is the more reliable use of this than
// trusting any single absolute score.
//
// Every call is funded by the single shared OPENROUTER_API_KEY, but each user may only spend their
// own monthly allowance: the spend guard below reserves the cost before the provider call and
// settles it into generation_log afterwards. Requires supabase/migrations/
// 202610010001_generation_guard.sql (and the generation_log table — see admin-list-generations).

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const EVAL_MODEL = 'openai/gpt-5.6-terra';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// openai/gpt-5.6-terra doesn't publish a fixed per-call USD rate — a rough flat estimate per
// image evaluated, kept in sync by hand with EVALUATE_CREATIVE_PRICE_PER_IMAGE_USD in
// src/types.ts.
const PRICE_PER_IMAGE_USD = 0.03;

async function getCaller(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}



// The web build is served from a different origin than *.supabase.co, so every browser call
// here is cross-origin and triggers a CORS preflight (OPTIONS) first — without these headers
// on both the preflight and the real response, the browser blocks the request before it ever
// reaches this function.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT =
  'Ты — опытный арт-директор, оценивающий рекламные креативы (фото/картинки) перед запуском ' +
  'кампании на рекламных площадках (Kaspi, GDN, РСЯ/YAN, BYYD, Discovery). Тебе дают от 1 до 3 ' +
  'изображений одного и того же креатива (разные варианты). Оцени каждое ИСКЛЮЧИТЕЛЬНО по ' +
  'визуальным признакам, которые реально влияют на кликабельность рекламы: контраст главного ' +
  'объекта относительно фона, ясность фокуса (куда сразу падает взгляд), читаемость любого ' +
  'текста при уменьшении до размера мобильной ленты, заметность call-to-action (кнопки/призыва), ' +
  'эмоциональный крючок (лицо, взгляд, эмоция), визуальная перегруженность/шум, соответствие ' +
  'безопасным зонам указанной площадки (если площадка указана — учти, что верх/низ/края кадра ' +
  'часто обрезаются интерфейсом приложения).\n\n' +
  'ВАЖНО: ты НЕ можешь предсказать точный процент CTR — ни у одной модели нет статистики ' +
  'реальных показов/кликов для калибровки такого числа, и явно придуманный процент введёт ' +
  'пользователя в заблуждение. Вместо этого дай оценку "силы креатива" по шкале 1-10 (это ' +
  'экспертное сравнительное суждение, не измеренная величина) и конкретные, действенные ' +
  'замечания.\n\n' +
  'Ответь СТРОГО валидным JSON без markdown-разметки, без пояснений до или после, по схеме:\n' +
  '{"variants":[{"score":<1-10>,"strengths":["...","..."],"weaknesses":["...","..."]}],' +
  '"verdict":"<заполняй только если изображений больше одного — короткий абзац, какой вариант ' +
  'сильнее и почему>","winnerIndex":<индекс лучшего варианта с 0, только если изображений ' +
  'больше одного>}\n' +
  'В каждом variants — 2-4 strengths и 2-4 weaknesses, коротко и по делу, на русском языке. ' +
  'Порядок variants должен точно совпадать с порядком присланных изображений.';

interface EvaluationBody {
  images?: string[];
  platform?: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('Model response had no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

// ---- Spend guard (security audit C-1/M-1). The same block is pasted into every paid function
// (they deploy as single files, no shared imports). Before a paid provider call the estimated cost
// is reserved against the caller's monthly allowance — who may spend what is decided in ONE place,
// supabase/migrations/202610010001_generation_guard.sql. After the call the reservation is settled
// with the real cost (that writes generation_log, once) or released if the call failed.
class GuardError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
const GUARD_ERRORS: Record<string, [number, string]> = {
  email_not_confirmed: [403, 'Подтвердите email, чтобы пользоваться генерацией.'],
  quota_exceeded: [402, 'Лимит генераций на этот месяц исчерпан.'],
  too_many_jobs: [429, 'Слишком много генераций одновременно — дождитесь завершения.'],
  job_too_expensive: [400, 'Запрос слишком дорогой для одной генерации.'],
};
const badRequest = (message: string) => new GuardError(400, 'bad_request', message);

async function reserveSpend(userId: string, model: string, category: string, amountUsd: number): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('reserve_generation', {
    p_user: userId,
    p_model: model,
    p_category: category,
    p_amount: Math.max(0, Number(amountUsd) || 0),
  });
  if (error) {
    const code = Object.keys(GUARD_ERRORS).find((k) => (error.message ?? '').includes(k));
    if (code) throw new GuardError(GUARD_ERRORS[code][0], code, GUARD_ERRORS[code][1]);
    throw error;
  }
  return data as string;
}

async function settleSpend(reservation: string | null, email: string, costUsd: number): Promise<void> {
  if (!reservation) return;
  const { error } = await supabaseAdmin.rpc('settle_generation', { p_reservation: reservation, p_email: email, p_cost: costUsd });
  if (error) console.error('settle_generation failed', error);
}

// Releases an unsettled reservation and turns any error into a response without internal details
// (audit L-2) — the details go to the function's logs instead.
async function failResponse(err: unknown, reservation: string | null, message: string): Promise<Response> {
  if (reservation) {
    const { error } = await supabaseAdmin.rpc('release_generation', { p_reservation: reservation });
    if (error) console.error('release_generation failed', error);
  }
  if (err instanceof GuardError) return jsonResponse({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return jsonResponse({ error: message }, 500);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Reference images: https URLs or image data URLs only, bounded in size.
const MAX_IMAGE_REF_CHARS = 12_000_000;
const isImageRef = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_IMAGE_REF_CHARS && (v.startsWith('https://') || v.startsWith('data:image/'));
const clipText = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
// ---- end of spend guard

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let reservation: string | null = null;
  try {
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = caller.id;

    const body: EvaluationBody = await req.json().catch(() => ({}) as EvaluationBody);
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.every(isImageRef)) throw badRequest('Images must be https or data:image URLs.');
    body.platform = clipText(body.platform, 60);
    if (images.length === 0 || images.length > 3) {
      return new Response(JSON.stringify({ error: 'Provide between 1 and 3 images.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const costUsd = PRICE_PER_IMAGE_USD * images.length;
    reservation = await reserveSpend(callerId, EVAL_MODEL, 'evaluate', costUsd);

    const promptLines = [
      body.platform
        ? `Площадка размещения: ${body.platform}.`
        : 'Площадка размещения не указана — оценивай по общим критериям.',
      `Количество вариантов: ${images.length}.`,
    ];

    const userContent: (
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    )[] = [{ type: 'text', text: promptLines.join(' ') }];
    for (const url of images) userContent.push({ type: 'image_url', image_url: { url } });

    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EVAL_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        // Opts into OpenRouter reporting the ACTUAL dollar cost of this call in
        // data.usage.cost, preferred below over PRICE_PER_IMAGE_USD's flat estimate.
        usage: { include: true },
        max_tokens: 2000,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter chat error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const realCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;

    await settleSpend(reservation, caller.email, realCostUsd ?? costUsd);
    reservation = null;

    const parsed = extractJson(text) as {
      variants?: { score?: number; strengths?: string[]; weaknesses?: string[] }[];
      verdict?: string;
      winnerIndex?: number;
    };

    const variants = (parsed.variants ?? []).slice(0, images.length).map((v) => ({
      score: typeof v.score === 'number' ? Math.max(1, Math.min(10, Math.round(v.score))) : 5,
      strengths: Array.isArray(v.strengths) ? v.strengths.slice(0, 6).map(String) : [],
      weaknesses: Array.isArray(v.weaknesses) ? v.weaknesses.slice(0, 6).map(String) : [],
    }));
    // Model output is untrusted free text parsed as JSON — pad to match the image count so the
    // client always gets one card per uploaded image, even if the model returned fewer.
    while (variants.length < images.length) {
      variants.push({ score: 5, strengths: [], weaknesses: [] });
    }

    const result = {
      variants,
      verdict: images.length > 1 && typeof parsed.verdict === 'string' ? parsed.verdict : undefined,
      winnerIndex:
        images.length > 1 && typeof parsed.winnerIndex === 'number'
          ? Math.max(0, Math.min(images.length - 1, Math.round(parsed.winnerIndex)))
          : undefined,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось оценить креативы. Попробуйте ещё раз.');
  }
});
