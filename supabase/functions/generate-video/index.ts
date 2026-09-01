// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-video" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: REPLICATE_API_KEY (Edge Functions → generate-video → Secrets). SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY are normally already set automatically for Edge Functions.
//
// Requires the user_credits table and deduct_credit_balance() function — see the SQL comment
// in lemonsqueezy-webhook/index.ts.

import Replicate from 'npm:replicate';
import { createClient } from 'npm:@supabase/supabase-js@2';

const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY') ?? '';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Kept in sync by hand with VIDEO_PRICE_PER_SECOND_USD/estimateVideoCost in src/types.ts.
const VIDEO_PRICE_PER_SECOND_USD: Record<string, Record<string, number>> = {
  'bytedance/seedance-2.0': { '480p': 0.15, '720p': 0.3 },
  'bytedance/seedance-2.5': { '480p': 0.11, '720p': 0.24, '1080p': 0.4 },
  'kwaivgi/kling-v3-video': { '720p': 0.126, '1080p': 0.168 },
};

function estimateVideoCost(model: string, resolution: string, duration: number): number {
  const rates = VIDEO_PRICE_PER_SECOND_USD[model];
  if (!rates) return 0;
  const perSecond = rates[resolution] ?? Object.values(rates)[0];
  return perSecond * Math.max(1, duration);
}

async function getCallerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

async function getBalanceUsd(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('user_credits')
    .select('balance_usd')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.balance_usd ?? 0;
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

function buildVideoInput(
  model: string,
  prompt: string,
  image: string | undefined,
  aspectRatio: string,
  duration: number,
  resolution: string
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt };
  if (image) input.image = image;
  const isImageToVideo = Boolean(image);

  if (model.startsWith('bytedance/seedance')) {
    if (!isImageToVideo) {
      input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
    }
    input.duration = Math.round(duration);
    input.resolution = resolution;
    return input;
  }
  if (model === 'kwaivgi/kling-v3-video') {
    if (!isImageToVideo) {
      input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '9:16', '1:1']);
    }
    input.duration = Math.round(duration);
    input.mode = resolution === '1080p' ? 'pro' : 'standard';
    return input;
  }
  input.duration = Math.round(duration);
  return input;
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
    const callerId = await getCallerId(req);
    if (!callerId) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const params = await req.json();
    const { model, prompt, image, aspectRatio, duration, resolution } = params;

    const costUsd = estimateVideoCost(model, resolution, duration);
    const balanceUsd = await getBalanceUsd(callerId);
    if (costUsd > balanceUsd) {
      return new Response(
        JSON.stringify({ error: 'Недостаточно средств на балансе. Пополните тариф, чтобы продолжить.' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const input = buildVideoInput(model, prompt, image, aspectRatio, duration, resolution);
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run(model, { input });

    if (costUsd > 0) {
      const { error: deductError } = await supabaseAdmin.rpc('deduct_credit_balance', {
        p_user_id: callerId,
        p_amount_usd: costUsd,
      });
      if (deductError) console.error('Failed to deduct credit balance', deductError);
    }

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
