// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-image" → paste this file → Deploy.
//
// Leave "Verify JWT" ON (the default) — that's what stops anonymous callers from using your
// paid API credits; only requests carrying a valid logged-in user's Supabase session token
// reach this code.
//
// After deploying, set these secrets (Edge Functions → generate-image → Secrets):
//   OPENROUTER_API_KEY — your OpenRouter token (openrouter.ai/settings/keys) — backs Nano
//   Banana Pro/2 and GPT Image 2 via OpenRouter's Unified Image API.
//   REPLICATE_API_KEY — your Replicate token (replicate.com/account/api-tokens) — still needed:
//   OpenRouter has no background-removal/upscaling models, so "Удалить фон" and "Апскейлер" in
//   the Инструменты menu stay on Replicate.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — usually already set automatically for every
//   Edge Function in this project; only add them by hand if they're missing.
//
// Requires the user_credits table and the reserve_credit_balance()/refund_credit_balance()
// functions — see the SQL comment in lemonsqueezy-webhook/index.ts — and the generation_log
// table — see the SQL comment in admin-list-generations/index.ts.

import Replicate from 'npm:replicate';
import { createClient } from 'npm:@supabase/supabase-js@2';

const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY') ?? '';
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';

// Our internal model ids (used everywhere else in the app — src/types.ts, generation_log
// history, node data) predate this migration and don't match OpenRouter's own slugs for the
// same underlying models. Remapped only here, at the call site, so nothing else in the app
// needs to change.
const OPENROUTER_IMAGE_MODEL_SLUGS: Record<string, string> = {
  // gemini-3-pro-image-preview reached GA as gemini-3-pro-image (2026-05-28) and OpenRouter
  // retired the preview slug on 2026-06-25 — use the stable slug, not the preview one.
  'google/nano-banana-pro': 'google/gemini-3-pro-image',
  'google/nano-banana-2': 'google/gemini-3.1-flash-image',
  'google/nano-banana-2-lite': 'google/gemini-3.1-flash-lite-image',
  'openai/gpt-image-2': 'openai/gpt-image-2',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Kept in sync by hand with IMAGE_PRICE_USD/estimateImageCost in src/types.ts — Deno Edge
// Functions in this project are deployed by pasting one self-contained file, no shared imports.
// gpt-image-2's auto/low/medium/high keys are the values the client actually sends (shared with
// the Electron build's own UI — see the matching comment on IMAGE_MODEL_META in src/types.ts)
// but now hold OpenRouter's 1K/2K/4K prices; buildOpenRouterImageInput below maps low/medium/
// high to the matching resolution tier when calling OpenRouter. nano-banana-pro's 2K/4K and
// nano-banana-2-lite's 2K/4K are derived from OpenRouter's per-model Image Output token rate
// rather than independently confirmed.
const IMAGE_PRICE_USD: Record<string, Record<string, number> | number> = {
  'google/nano-banana-pro': { '1K': 0.134, '2K': 0.202, '4K': 0.302 },
  'google/nano-banana-2': { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  'google/nano-banana-2-lite': { '1K': 0.034, '2K': 0.051, '4K': 0.076 },
  'openai/gpt-image-2': { auto: 0.03, low: 0.03, medium: 0.05, high: 0.08 },
  'recraft-ai/recraft-v4-svg': 0.08,
};

function estimateImageCost(model: string, resolution: string | undefined): number {
  const entry = IMAGE_PRICE_USD[model];
  if (entry === undefined) return 0;
  return typeof entry === 'number' ? entry : (resolution && entry[resolution]) || Object.values(entry)[0];
}

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
// or Replicate call — returns false (caller must reject with 402) if the balance can't cover
// it, so an unpaid/exhausted account can no longer spend either shared key at all. Throws
// (letting the outer catch produce a generic 500) on a genuine DB error, so that's never
// confused with a real "insufficient balance" rejection.
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

// These have no OpenRouter equivalent (background removal/upscaling utility models) or are a
// dormant fallback path (see the flux-kontext comment in src/types.ts near ADAPT_MODEL, never
// reached by the current UI) — kept on Replicate.
const REPLICATE_ONLY_IMAGE_MODELS = new Set([
  '851-labs/background-remover',
  'nightmareai/real-esrgan',
  'black-forest-labs/flux-kontext-pro',
  'black-forest-labs/flux-kontext-max',
]);

function buildImageInput(
  model: string,
  prompt: string,
  aspectRatio: string,
  image?: string,
  width?: number,
  height?: number
): Record<string, unknown> {
  // Инструменты → Удалить фон / Апскейлер (see the "Инструменты" toolbar menu in App.tsx) —
  // both are single-image utility models, not part of the aspect-ratio/prompt-driven family
  // below, so they're special-cased first and ignore prompt/aspectRatio entirely.
  if (model === '851-labs/background-remover') {
    return { image };
  }
  if (model === 'nightmareai/real-esrgan') {
    return { image, scale: 2 };
  }
  // black-forest-labs/flux-kontext-pro / -max: dormant fallback, never called by the current UI.
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

// OpenRouter's Unified Image API (POST /api/v1/images) is the same request/response shape
// across every image model it fronts — only the model slug and which optional fields a given
// model honors differ (discoverable via GET /api/v1/images/models). Reference images for
// editing/variation go under input_references regardless of what Replicate called that field
// for the same model ("image_input" / "input_images").
function buildOpenRouterImageInput(
  model: string,
  prompt: string,
  aspectRatio: string,
  image?: string,
  images?: string[],
  resolution?: string
): Record<string, unknown> {
  const refImages = images && images.length > 0 ? images : image ? [image] : undefined;
  const supportedRatios: Record<string, string[]> = {
    'google/nano-banana-pro': ['1:1', '3:4', '4:3', '9:16', '16:9'],
    'google/nano-banana-2': ['1:1', '16:9', '9:16'],
    'openai/gpt-image-2': ['1:1', '3:2', '2:3'],
  };
  const input: Record<string, unknown> = {
    model: OPENROUTER_IMAGE_MODEL_SLUGS[model] ?? model,
    prompt,
    aspect_ratio: mapToSupportedRatio(aspectRatio, supportedRatios[model] ?? ['1:1', '16:9', '9:16']),
  };
  if (refImages) input.input_references = refImages;
  if (resolution && resolution !== 'auto') {
    // GPT Image 2's client-facing values are still the old Replicate quality tiers
    // (auto/low/medium/high — see the matching comment on IMAGE_MODEL_META in src/types.ts,
    // shared with the Electron build), translated to OpenRouter's 1K/2K/4K resolution tiers
    // only here. Nano Banana models already send '1K'/'2K'/'4K' directly.
    const gptImage2ResolutionTier: Record<string, string> = { low: '1K', medium: '2K', high: '4K' };
    input.resolution =
      model === 'openai/gpt-image-2' ? (gptImage2ResolutionTier[resolution] ?? resolution) : resolution;
  }
  return input;
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
    item.url ? item.url : `data:${item.media_type ?? 'image/png'};base64,${item.b64_json ?? ''}`
  );
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
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = caller.id;

    const params = await req.json();
    const { model, prompt, aspectRatio, resolution, image, images, width, height } = params;

    const costUsd = estimateImageCost(model, resolution);

    if (!(await reserveBalance(callerId, costUsd))) {
      return new Response(JSON.stringify({ error: 'Insufficient balance.', code: 'insufficient_balance' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let urls: string[];
    try {
      if (REPLICATE_ONLY_IMAGE_MODELS.has(model)) {
        const input = buildImageInput(model, prompt, aspectRatio, image, width, height);
        const replicate = new Replicate({ auth: REPLICATE_API_KEY });
        const output = await runReplicateWithRetry(replicate, model, input);
        urls = normalizeOutput(output);
      } else {
        const input = buildOpenRouterImageInput(model, prompt, aspectRatio, image, images, resolution);
        urls = await callOpenRouterImage(input);
      }
    } catch (err) {
      await refundBalance(callerId, costUsd);
      throw err;
    }

    void logGeneration(callerId, caller.email, model, 'image', costUsd);

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
