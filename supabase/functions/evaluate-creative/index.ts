// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "evaluate-creative" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: REPLICATE_API_KEY (Edge Functions → evaluate-creative → Secrets).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// This is a heuristic design-quality read on an ad creative, not a statistical CTR
// prediction — no model here has real impression/click data to calibrate a percentage
// against, so the system prompt below deliberately asks for a 1-10 score plus concrete
// strengths/weaknesses instead of inventing a plausible-looking number. Comparing 2-3
// variants against each other (relative judgment) is the more reliable use of this than
// trusting any single absolute score.
//
// Requires the user_credits table and deduct_credit_balance() function — see the SQL comment
// in lemonsqueezy-webhook/index.ts — and the generation_log table — see the SQL comment in
// admin-list-generations/index.ts.

import Replicate from 'npm:replicate';
import { createClient } from 'npm:@supabase/supabase-js@2';

const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY') ?? '';

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

async function logGeneration(
  userId: string,
  email: string,
  model: string,
  category: string,
  costUsd: number
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('generation_log')
    .insert({ user_id: userId, email, model, category, cost_usd: costUsd });
  if (error) console.error('Failed to log generation', error);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = caller.id;

    const body: EvaluationBody = await req.json();
    const images = body.images ?? [];
    if (images.length === 0 || images.length > 3) {
      return new Response(JSON.stringify({ error: 'Provide between 1 and 3 images.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Balance is no longer a hard gate here — see the matching comment in generate-image.
    const costUsd = PRICE_PER_IMAGE_USD * images.length;

    const promptLines = [
      body.platform
        ? `Площадка размещения: ${body.platform}.`
        : 'Площадка размещения не указана — оценивай по общим критериям.',
      `Количество вариантов: ${images.length}.`,
    ];

    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run('openai/gpt-5.6-terra', {
      input: {
        prompt: promptLines.join(' '),
        system_prompt: SYSTEM_PROMPT,
        image_input: images,
      },
    });

    const { error: deductError } = await supabaseAdmin.rpc('deduct_credit_balance', {
      p_user_id: callerId,
      p_amount_usd: costUsd,
    });
    if (deductError) console.error('Failed to deduct credit balance', deductError);
    void logGeneration(callerId, caller.email, 'openai/gpt-5.6-terra', 'evaluate', costUsd);

    const text = Array.isArray(output) ? output.map(String).join('') : String(output);
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
