// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-video-pro" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY (Edge Functions → generate-video-pro → Secrets;
// openrouter.ai/settings/keys).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// Field names for Seedance 2.5's multimodal reference arrays ("images"/"videos"/"audios")
// aren't published in an exact machine-readable schema by OpenRouter for this specific model —
// if OpenRouter rejects these as unexpected properties, its error message names the actual
// expected key (they map onto OpenRouter's general input_references field for other models, but
// Seedance 2.5's own reference-array shape predates that and may differ — verify with a live
// call and adjust buildVideoInput below).
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
const VIDEO_MODEL = 'bytedance/seedance-2.5';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Kept in sync by hand with VIDEO_PRICE_PER_SECOND_USD/estimateVideoCost in src/types.ts —
// this function always targets bytedance/seedance-2.5.
const SEEDANCE_25_RATES: Record<string, number> = { '480p': 0.11, '720p': 0.24, '1080p': 0.4 };

function estimateVideoCost(resolution: string, duration: number): number {
  const perSecond = SEEDANCE_25_RATES[resolution] ?? Object.values(SEEDANCE_25_RATES)[0];
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

// See the matching comment in generate-video/index.ts — same async submit/poll/download shape,
// duplicated here since Edge Functions in this project are deployed as self-contained files.
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
    const { prompt, aspectRatio, duration, resolution, images, videos, audios } = params;

    const costUsd = estimateVideoCost(resolution, duration);

    if (!(await reserveBalance(callerId, costUsd))) {
      return new Response(JSON.stringify({ error: 'Insufficient balance.', code: 'insufficient_balance' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const input: Record<string, unknown> = {
      model: VIDEO_MODEL,
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']),
      duration: Math.round(duration),
      resolution,
    };
    if (images?.length) input.images = images;
    if (videos?.length) input.videos = videos;
    if (audios?.length) input.audios = audios;

    let url: string;
    try {
      const job = await submitOpenRouterVideoJob(input);
      const completed = await pollOpenRouterVideoJob(job.id);
      url = await downloadAndStoreVideo(completed.id ?? job.id);
    } catch (err) {
      await refundBalance(callerId, costUsd);
      throw err;
    }

    void logGeneration(callerId, caller.email, VIDEO_MODEL, 'video', costUsd);

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
