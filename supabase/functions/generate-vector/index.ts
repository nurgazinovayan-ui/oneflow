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
// Requires the user_credits table and the reserve_credit_balance()/refund_credit_balance()
// functions — see the SQL comment in lemonsqueezy-webhook/index.ts — and the generation_log
// table — see the SQL comment in admin-list-generations/index.ts.

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

// Hard stop: reserves costUsd from the caller's balance atomically, BEFORE the paid OpenRouter
// call — returns false (caller must reject with 402) if the balance can't cover it, so an
// unpaid/exhausted account can no longer spend the shared OpenRouter key at all. Throws (letting
// the outer catch produce a generic 500) on a genuine DB error, so that's never confused with a
// real "insufficient balance" rejection.
async function reserveBalance(userId: string, costUsd: number): Promise<boolean> {
  if (costUsd <= 0) return true;
  const { data, error } = await supabaseAdmin.rpc('reserve_credit_balance', {
    p_user_id: userId,
    p_amount_usd: costUsd,
  });
  if (error) throw error;
  return data !== null;
}

// Pairs with reserveBalance — called if the generation itself fails after a successful
// reservation, so the user isn't left charged for nothing.
async function refundBalance(userId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const { error } = await supabaseAdmin.rpc('refund_credit_balance', {
    p_user_id: userId,
    p_amount_usd: costUsd,
  });
  if (error) console.error('Failed to refund credit balance', error);
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

async function callOpenRouterImage(input: Record<string, unknown>): Promise<string[]> {
  const res = await fetch(OPENROUTER_IMAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`OpenRouter images error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const items: { b64_json?: string; media_type?: string; url?: string }[] = data.data ?? [];
  return items.map((item) =>
    item.url ? item.url : `data:${item.media_type ?? 'image/svg+xml'};base64,${item.b64_json ?? ''}`
  );
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

    const params = await req.json();
    const { prompt, aspectRatio } = params;

    if (!(await reserveBalance(callerId, RECRAFT_V4_SVG_PRICE_USD))) {
      return new Response(JSON.stringify({ error: 'Insufficient balance.', code: 'insufficient_balance' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const input = buildVectorInput(prompt, aspectRatio);
    let urls: string[];
    try {
      urls = await callOpenRouterImage(input);
    } catch (err) {
      await refundBalance(callerId, RECRAFT_V4_SVG_PRICE_USD);
      throw err;
    }

    void logGeneration(callerId, caller.email, 'recraft-ai/recraft-v4-svg', 'vector', RECRAFT_V4_SVG_PRICE_USD);

    return new Response(JSON.stringify(urls), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
