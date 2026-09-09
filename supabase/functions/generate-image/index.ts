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
// No per-user billing here — every generation is funded by the single shared
// OPENROUTER_API_KEY, topped up directly at openrouter.ai. Requires the generation_log table
// — see the SQL comment in admin-list-generations/index.ts — for admin usage history only.

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
// bytedance-seed/seedream-5-0-lite's 4K rate, recraft/recraft-v4-styles-pro's flat rate (base
// single-style-reference price; extra references and moodboards cost slightly more) and
// krea/krea-2-large's flat rate are the base/lowest published tier — not broken out further.
const IMAGE_PRICE_USD: Record<string, Record<string, number> | number> = {
  'google/nano-banana-pro': { '1K': 0.134, '2K': 0.202, '4K': 0.302 },
  'google/nano-banana-2': { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  'google/nano-banana-2-lite': { '1K': 0.034, '2K': 0.051, '4K': 0.076 },
  'openai/gpt-image-2': { auto: 0.03, low: 0.03, medium: 0.05, high: 0.08 },
  'recraft-ai/recraft-v4-svg': 0.08,
  'bytedance-seed/seedream-5-0-pro': { '1K': 0.045, '2K': 0.09 },
  'recraft/recraft-v4-styles-pro': 0.105,
  'openai/gpt-image-2.5-sunburst': { '1K': 0.06, '2K': 0.1, '4K': 0.16 },
  'openai/gpt-image-2.5-flare': { '1K': 0.06, '2K': 0.1, '4K': 0.16 },
  'x-ai/grok-imagine-image-2.0': { '1K': 0.04, '2K': 0.08 },
  'krea/krea-2-large': 0.06,
  'bytedance-seed/seedream-5-0-lite': { '2K': 0.035, '4K': 0.07 },
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

// GPT Image 2.5 Sunburst/Flare accept an arbitrary "size" as WIDTHxHEIGHT instead of a fixed
// aspect_ratio tier, but only within: both edges multiples of 16px, each edge at most 3840px,
// aspect ratio between 1:3 and 3:1, and total pixels between 655,360 and 8,294,400. Clamped here
// so the "Адаптация" node's arbitrary user-entered format sizes (see ADAPT_MODEL in
// src/types.ts) never get rejected outright — extreme ratios past 3:1 (thin banners) still get
// clamped to 3:1 and cleaned up by the client's local coverResizeExact crop afterward, same as
// the old aspect-ratio-bucket approach already relied on for those cases. The pixel-count target
// is nudged slightly inside the real 655,360–8,294,400 bounds, and the ratio is re-clamped after
// 16px rounding, because rounding width/height independently can otherwise push either bound
// back outside the API's limits by a few thousand pixels or a hundredth of the ratio.
function clampGptImage25Size(width: number, height: number): { width: number; height: number } {
  let w = width;
  let h = height;
  const ratio = w / h;
  if (ratio > 3) w = h * 3;
  else if (ratio < 1 / 3) h = w * 3;
  const totalPixels = w * h;
  if (totalPixels < 700000) {
    const scale = Math.sqrt(700000 / totalPixels);
    w *= scale;
    h *= scale;
  } else if (totalPixels > 8200000) {
    const scale = Math.sqrt(8200000 / totalPixels);
    w *= scale;
    h *= scale;
  }
  let rw = Math.min(3840, Math.max(16, Math.round(w / 16) * 16));
  let rh = Math.min(3840, Math.max(16, Math.round(h / 16) * 16));
  if (rw / rh > 3) rw = Math.max(16, Math.round((rh * 3) / 16) * 16);
  else if (rw / rh < 1 / 3) rh = Math.max(16, Math.round((rw * 3) / 16) * 16);
  return { width: rw, height: rh };
}

// OpenRouter's Unified Image API (POST /api/v1/images) is the same request/response shape
// across every image model it fronts — only the model slug and which optional fields a given
// model honors differ (discoverable via GET /api/v1/images/models). Reference images for
// editing/variation go under input_references regardless of what Replicate called that field
// for the same model ("image_input" / "input_images"). Each entry must be an
// { type: "image_url", image_url: { url } } object — a bare URL/data-URL string is rejected
// with a Zod "expected object, received string" 400.
function buildOpenRouterImageInput(
  model: string,
  prompt: string,
  aspectRatio: string,
  image?: string,
  images?: string[],
  resolution?: string,
  width?: number,
  height?: number
): Record<string, unknown> {
  const refImages = images && images.length > 0 ? images : image ? [image] : undefined;
  const supportedRatios: Record<string, string[]> = {
    'google/nano-banana-pro': ['1:1', '3:4', '4:3', '9:16', '16:9'],
    'google/nano-banana-2': ['1:1', '16:9', '9:16'],
    'openai/gpt-image-2': ['1:1', '3:2', '2:3'],
    'openai/gpt-image-2.5-sunburst': ['1:1', '3:2', '2:3'],
    'openai/gpt-image-2.5-flare': ['1:1', '3:2', '2:3'],
    'x-ai/grok-imagine-image-2.0': ['1:1', '16:9', '9:16', '4:3', '3:4'],
    'krea/krea-2-large': ['1:1', '16:9', '9:16', '4:3', '3:4'],
    // bytedance-seed/seedream-5-0-pro and -lite support a much wider set (13+ ratios) — the
    // app's own ASPECT_RATIOS list is a subset of that, so every value it can send already maps
    // 1:1 without needing an entry here; same for recraft/recraft-v4-styles-pro.
  };
  const input: Record<string, unknown> = {
    model: OPENROUTER_IMAGE_MODEL_SLUGS[model] ?? model,
    prompt,
  };
  if (width && height && (model === 'openai/gpt-image-2.5-sunburst' || model === 'openai/gpt-image-2.5-flare')) {
    const clamped = clampGptImage25Size(width, height);
    input.size = `${clamped.width}x${clamped.height}`;
  } else {
    input.aspect_ratio = mapToSupportedRatio(aspectRatio, supportedRatios[model] ?? ['1:1', '16:9', '9:16']);
  }
  if (refImages) {
    input.input_references = refImages.map((url) => ({ type: 'image_url', image_url: { url } }));
  }
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

    let urls: string[];
    if (REPLICATE_ONLY_IMAGE_MODELS.has(model)) {
      const input = buildImageInput(model, prompt, aspectRatio, image, width, height);
      const replicate = new Replicate({ auth: REPLICATE_API_KEY });
      const output = await runReplicateWithRetry(replicate, model, input);
      urls = normalizeOutput(output);
    } else {
      const input = buildOpenRouterImageInput(model, prompt, aspectRatio, image, images, resolution, width, height);
      urls = await callOpenRouterImage(input);
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
