// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-vector" → paste this file → Deploy.
//
// Leave "Verify JWT" ON (the default) — that's what stops anonymous callers from using your
// Replicate credits; only requests carrying a valid logged-in user's Supabase session token
// reach this code.
//
// After deploying, set one secret (Edge Functions → generate-vector → Secrets):
//   REPLICATE_API_KEY — your Replicate token (replicate.com/account/api-tokens)
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
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

// Kept in sync by hand with IMAGE_PRICE_USD['recraft-ai/recraft-v4-svg'] in src/types.ts.
const RECRAFT_V4_SVG_PRICE_USD = 0.08;

async function getCaller(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

async function getBalanceUsd(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('user_credits')
    .select('balance_usd')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.balance_usd ?? 0;
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
    prompt,
    aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '4:3', '3:2', '16:9', '9:16']),
  };
}

function normalizeOutput(output: unknown): string[] {
  const toUrl = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const anyItem = item as { url?: unknown };
      if (typeof anyItem.url === 'function') return String((anyItem.url as () => unknown)());
      if (typeof anyItem.url === 'string') return anyItem.url;
    }
    return String(item);
  };
  if (Array.isArray(output)) return output.map(toUrl);
  return [toUrl(output)];
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

    const balanceUsd = await getBalanceUsd(callerId);
    if (RECRAFT_V4_SVG_PRICE_USD > balanceUsd) {
      return new Response(
        JSON.stringify({ error: 'Недостаточно средств на балансе. Пополните тариф, чтобы продолжить.' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const params = await req.json();
    const { prompt, aspectRatio } = params;
    const input = buildVectorInput(prompt, aspectRatio);
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run('recraft-ai/recraft-v4-svg', { input });

    const { error: deductError } = await supabaseAdmin.rpc('deduct_credit_balance', {
      p_user_id: callerId,
      p_amount_usd: RECRAFT_V4_SVG_PRICE_USD,
    });
    if (deductError) console.error('Failed to deduct credit balance', deductError);
    void logGeneration(callerId, caller.email, 'recraft-ai/recraft-v4-svg', 'vector', RECRAFT_V4_SVG_PRICE_USD);

    return new Response(JSON.stringify(normalizeOutput(output)), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
