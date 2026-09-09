// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-video" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY (Edge Functions → generate-video → Secrets;
// openrouter.ai/settings/keys). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are normally already
// set automatically for Edge Functions.
//
// Requires the user_credits table and the reserve_credit_balance()/refund_credit_balance()
// functions — see the SQL comment in lemonsqueezy-webhook/index.ts — the generation_log
// table — see the SQL comment in admin-list-generations/index.ts — AND the
// "ai-generated-videos" Storage bucket from supabase/migrations/202609090002_ai_video_bucket.sql
// (OpenRouter's video content endpoint requires the shared API key on every request, so the
// finished video is downloaded here and re-hosted as a plain public URL for the client).

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_VIDEOS_URL = 'https://openrouter.ai/api/v1/videos';
const VIDEO_BUCKET = 'ai-generated-videos';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Kept in sync by hand with VIDEO_PRICE_PER_SECOND_USD/estimateVideoCost in src/types.ts.
// Seedance 2.0's 720p rate, Seedance 2.0 Mini's 720p rate, and Veo 3.1 Fast's 1080p rate are
// interpolated (not directly confirmed on OpenRouter's own pricing page at the time this was
// written) — the rest match OpenRouter's published per-second rates.
const VIDEO_PRICE_PER_SECOND_USD: Record<string, Record<string, number>> = {
  'bytedance/seedance-2.0': { '480p': 0.067, '720p': 0.2 },
  'bytedance/seedance-2.5': { '480p': 0.103, '720p': 0.231, '1080p': 0.4 },
  'kwaivgi/kling-v3-video': { '720p': 0.126, '1080p': 0.168 },
  'google/veo-3.1-fast': { '720p': 0.1, '1080p': 0.15, '4K': 0.3 },
  'minimax/hailuo-3-max': { '480p': 0.05, '768p': 0.08 },
  'bytedance/seedance-2.0-mini': { '480p': 0.01345, '720p': 0.04 },
  'black-forest-labs/flux-3-video': { '720p': 0.17, '1080p': 0.29 },
};

function estimateVideoCost(model: string, resolution: string, duration: number): number {
  const rates = VIDEO_PRICE_PER_SECOND_USD[model];
  if (!rates) return 0;
  const perSecond = rates[resolution] ?? Object.values(rates)[0];
  return perSecond * Math.max(1, duration);
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

// Our internal model id 'kwaivgi/kling-v3-video' predates this migration and used a Replicate
// "mode" input param to pick between two quality tiers of the same model; OpenRouter instead
// fronts them as two distinct model slugs.
function openRouterVideoModelSlug(model: string, resolution: string): string {
  if (model === 'kwaivgi/kling-v3-video') {
    return resolution === '1080p' ? 'kwaivgi/kling-v3.0-pro' : 'kwaivgi/kling-v3.0-std';
  }
  return model; // bytedance/seedance-2.0 and -2.5 use identical slugs on OpenRouter.
}

function buildVideoInput(
  model: string,
  prompt: string,
  image: string | undefined,
  aspectRatio: string,
  duration: number,
  resolution: string
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    model: openRouterVideoModelSlug(model, resolution),
    prompt,
    duration: Math.round(duration),
  };
  if (resolution) input.resolution = resolution;
  if (image) {
    input.frame_images = [{ type: 'image_url', image_url: { url: image }, frame_type: 'first_frame' }];
  } else if (model.startsWith('bytedance/seedance')) {
    input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
  } else if (model === 'kwaivgi/kling-v3-video') {
    input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '9:16', '1:1']);
  } else if (model === 'google/veo-3.1-fast') {
    input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '9:16']);
  } else if (model === 'minimax/hailuo-3-max' || model === 'black-forest-labs/flux-3-video') {
    input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
  }
  return input;
}

async function submitOpenRouterVideoJob(input: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(OPENROUTER_VIDEOS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`OpenRouter video submit error ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Video generation is async on OpenRouter (submit → poll → download), unlike Replicate's
// synchronous replicate.run() this used to call — but the Edge Function still blocks across the
// whole thing so the client sees the same "await one call, get a URL back" shape as before. This
// needs the function's own execution-time limit (Supabase project settings → Edge Functions) to
// comfortably exceed a few minutes; the 8-minute budget below is generous for every model
// currently wired in, but if OpenRouter's own docs' "poll every ~30s" pacing turns out to be a
// hard rate limit rather than just a suggestion, lower POLL_INTERVAL_MS accordingly.
const POLL_INTERVAL_MS = 5000;
const POLL_BUDGET_MS = 8 * 60 * 1000;

async function pollOpenRouterVideoJob(jobId: string): Promise<{ id: string }> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${OPENROUTER_VIDEOS_URL}/${jobId}`, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) throw new Error(`OpenRouter video poll error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.status === 'completed') return data;
    if (data.status === 'failed' || data.status === 'cancelled' || data.status === 'expired') {
      throw new Error(`Video generation ${data.status}: ${data.error ?? 'unknown error'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Video generation timed out.');
}

async function downloadAndStoreVideo(jobId: string): Promise<string> {
  const res = await fetch(`${OPENROUTER_VIDEOS_URL}/${jobId}/content?index=0`, {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenRouter video download error ${res.status}: ${await res.text()}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const objectPath = `${crypto.randomUUID()}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from(VIDEO_BUCKET)
    .upload(objectPath, bytes, { contentType: 'video/mp4', upsert: false });
  if (error) throw error;
  const { data: pub } = supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(objectPath);
  return pub.publicUrl;
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
    const { model, prompt, image, aspectRatio, duration, resolution } = params;

    const costUsd = estimateVideoCost(model, resolution, duration);

    if (!(await reserveBalance(callerId, costUsd))) {
      return new Response(JSON.stringify({ error: 'Insufficient balance.', code: 'insufficient_balance' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const input = buildVideoInput(model, prompt, image, aspectRatio, duration, resolution);
    let url: string;
    try {
      const job = await submitOpenRouterVideoJob(input);
      const completed = await pollOpenRouterVideoJob(job.id);
      url = await downloadAndStoreVideo(completed.id ?? job.id);
    } catch (err) {
      await refundBalance(callerId, costUsd);
      throw err;
    }

    void logGeneration(callerId, caller.email, model, 'video', costUsd);

    return new Response(JSON.stringify([url]), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
