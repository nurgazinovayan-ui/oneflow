// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-image" → paste this file → Deploy.
//
// Leave "Verify JWT" ON (the default) — that's what stops anonymous callers from using your
// Replicate credits; only requests carrying a valid logged-in user's Supabase session token
// reach this code.
//
// After deploying, set these secrets (Edge Functions → generate-image → Secrets):
//   REPLICATE_API_KEY — your Replicate token (replicate.com/account/api-tokens)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — usually already set automatically for every
//   Edge Function in this project; only add them by hand if they're missing.
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

// Kept in sync by hand with IMAGE_PRICE_USD/estimateImageCost in src/types.ts — Deno Edge
// Functions in this project are deployed by pasting one self-contained file, no shared imports.
const IMAGE_PRICE_USD: Record<string, Record<string, number> | number> = {
  'google/nano-banana-pro': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'google/nano-banana-2': { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  'openai/gpt-image-2': { auto: 0.08, low: 0.006, medium: 0.053, high: 0.211 },
  'recraft-ai/recraft-v4-svg': 0.08,
};

function estimateImageCost(model: string, resolution: string | undefined): number {
  const entry = IMAGE_PRICE_USD[model];
  if (entry === undefined) return 0;
  return typeof entry === 'number' ? entry : (resolution && entry[resolution]) || Object.values(entry)[0];
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

// The web build is served from a different origin than *.supabase.co (e.g. a Vercel/Netlify
// domain), so every browser call here is cross-origin. A POST with a JSON body and an
// Authorization header always triggers a CORS preflight (OPTIONS) first — without these
// headers on both the preflight and the real response, the browser blocks the request before
// it ever reaches this function, which looks like "generation silently does nothing".
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 768, height: 1344 },
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '5:4': { width: 1280, height: 1024 },
  '21:9': { width: 1344, height: 576 },
  '4:3': { width: 1024, height: 768 },
  '2:3': { width: 896, height: 1344 },
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

function roundTo32(n: number): number {
  return Math.max(32, Math.round(n / 32) * 32);
}

function buildImageInput(
  model: string,
  prompt: string,
  aspectRatio: string,
  image?: string,
  width?: number,
  height?: number,
  images?: string[],
  resolution?: string
): Record<string, unknown> {
  const refImages = images && images.length > 0 ? images : image ? [image] : undefined;

  // Инструменты → Удалить фон / Апскейлер (see the "Инструменты" toolbar menu in App.tsx) —
  // both are single-image utility models, not part of the aspect-ratio/prompt-driven family
  // below, so they're special-cased first and ignore prompt/aspectRatio entirely.
  if (model === '851-labs/background-remover') {
    return { image };
  }
  if (model === 'nightmareai/real-esrgan') {
    return { image, scale: 2 };
  }

  if (model === 'black-forest-labs/flux-kontext-pro' || model === 'black-forest-labs/flux-kontext-max') {
    const input: Record<string, unknown> = { prompt };
    if (image) input.input_image = image;
    if (width && height) {
      input.width = roundTo32(width);
      input.height = roundTo32(height);
    } else {
      input.aspect_ratio = aspectRatio;
    }
    return input;
  }
  if (model === 'google/nano-banana-pro') {
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '3:4', '4:3', '9:16', '16:9']),
      allow_fallback_model: true,
    };
    if (refImages) input.image_input = refImages;
    if (resolution) input.resolution = resolution;
    return input;
  }
  if (model === 'google/nano-banana-2') {
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '16:9', '9:16']),
    };
    if (refImages) input.image_input = refImages;
    if (resolution) input.resolution = resolution;
    return input;
  }
  if (model === 'openai/gpt-image-2') {
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '3:2', '2:3']),
    };
    if (refImages) input.input_images = refImages;
    if (resolution && resolution !== 'auto') input.quality = resolution;
    return input;
  }
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS['1:1'];
  return { prompt, width: dims.width, height: dims.height };
}

// Popular models (Nano Banana Pro/2 especially) frequently return a transient
// "ModelRateLimitError: ... currently unavailable due to high demand" when Replicate's
// backing capacity is saturated — retrying after a short delay usually succeeds.
function isTransientReplicateError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /rate.?limit|high demand|currently unavailable/i.test(message);
}

async function runReplicateWithRetry(
  replicate: Replicate,
  model: string,
  input: Record<string, unknown>,
  retries = 2,
  delayMs = 4000
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await replicate.run(model, { input });
    } catch (err) {
      if (attempt >= retries || !isTransientReplicateError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
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
    const { model, prompt, aspectRatio, resolution, image, images, width, height } = params;

    const costUsd = estimateImageCost(model, resolution);
    const balanceUsd = await getBalanceUsd(callerId);
    if (costUsd > balanceUsd) {
      return new Response(
        JSON.stringify({ error: 'Недостаточно средств на балансе. Пополните тариф, чтобы продолжить.' }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const input = buildImageInput(model, prompt, aspectRatio, image, width, height, images, resolution);
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await runReplicateWithRetry(replicate, model, input);

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
