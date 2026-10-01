// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-vector" → paste this file → Deploy.
//
// Leave "Verify JWT" ON (the default) — that's what stops anonymous callers from using your
// paid API credits; only requests carrying a valid logged-in user's Supabase session token
// reach this code.
//
// After deploying, set one secret (Edge Functions → generate-vector → Secrets):
//   OPENROUTER_API_KEY — your OpenRouter token (openrouter.ai/settings/keys)
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// Every call is funded by the single shared OPENROUTER_API_KEY, but each user may only spend their
// own monthly allowance: the spend guard below reserves the cost before the provider call and
// settles it into generation_log afterwards. Requires supabase/migrations/
// 202610010001_generation_guard.sql (and the generation_log table — see admin-list-generations).

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
// Our internal model id 'recraft-ai/recraft-v4-svg' predates this migration; OpenRouter fronts
// the same model under its own slug, remapped only here.
const OPENROUTER_VECTOR_MODEL = 'recraft/recraft-v4-vector';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Kept in sync by hand with IMAGE_PRICE_USD['recraft-ai/recraft-v4-svg'] in src/types.ts.
const RECRAFT_V4_SVG_PRICE_USD = 0.08;

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

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

function mapToSupportedRatio(ratio: string, supported: string[]): string {
  if (supported.includes(ratio)) return ratio;
  const target = ratioValue(ratio);
  let best = supported[0];
  let bestDiff = Infinity;
  for (const candidate of supported) {
    const diff = Math.abs(ratioValue(candidate) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

// Exact enum casing for aspect_ratio isn't published in a machine-readable schema; mapped
// onto the same aspect-ratio set already used elsewhere in the app.
function buildVectorInput(prompt: string, aspectRatio: string): Record<string, unknown> {
  return {
    model: OPENROUTER_VECTOR_MODEL,
    prompt,
    aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '4:3', '3:2', '16:9', '9:16']),
  };
}

// Returns both the generated URLs and, when OpenRouter reports it, the ACTUAL dollar amount
// charged for this call (data.usage.cost) — preferred over RECRAFT_V4_SVG_PRICE_USD's estimate
// whenever present, since the estimate can drift from OpenRouter's real rate.
async function callOpenRouterImage(
  input: Record<string, unknown>
): Promise<{ urls: string[]; realCostUsd: number | null }> {
  const res = await fetch(OPENROUTER_IMAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, usage: { include: true } }),
  });
  if (!res.ok) throw new Error(`OpenRouter images error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const items: { b64_json?: string; media_type?: string; url?: string }[] = data.data ?? [];
  const urls = items.map((item) =>
    item.url ? item.url : `data:${item.media_type ?? 'image/svg+xml'};base64,${item.b64_json ?? ''}`
  );
  const realCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
  return { urls, realCostUsd };
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
const validRatio = (v: unknown, fallback: string): string => (typeof v === 'string' && /^\d{1,2}:\d{1,2}$/.test(v) ? v : fallback);
// ---- end of spend guard

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let reservation: string | null = null;
  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: 'Not authenticated.' }, 401);
    const params = await req.json().catch(() => null);
    if (!params || typeof params !== 'object') throw badRequest('Bad request.');

    reservation = await reserveSpend(caller.id, 'recraft-ai/recraft-v4-svg', 'vector', RECRAFT_V4_SVG_PRICE_USD);

    const input = buildVectorInput(clipText(params.prompt, 4000), validRatio(params.aspectRatio, '1:1'));
    const { urls, realCostUsd } = await callOpenRouterImage(input);

    await settleSpend(reservation, caller.email, realCostUsd ?? RECRAFT_V4_SVG_PRICE_USD);
    reservation = null;
    return jsonResponse(urls);
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось сгенерировать вектор. Попробуйте ещё раз.');
  }
});
