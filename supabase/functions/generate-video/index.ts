// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-video" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY (Edge Functions → generate-video → Secrets;
// openrouter.ai/settings/keys). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are normally already
// set automatically for Edge Functions.
//
// Funded by the shared OPENROUTER_API_KEY, within each user's monthly allowance (spend guard
// below + supabase/migrations/202610010001_generation_guard.sql). Requires the generation_log
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

// The completed job object includes usage.cost when OpenRouter reports it — the ACTUAL dollar
// amount charged for this generation, preferred over VIDEO_PRICE_PER_SECOND_USD's estimate.
interface CompletedVideoJob {
  id: string;
  usage?: { cost?: number };
}

async function pollOpenRouterVideoJob(jobId: string): Promise<CompletedVideoJob> {
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

// Kept in sync by hand with VIDEO_MODEL_META in src/types.ts — the allowlist for this function.
const VIDEO_MODEL_LIMITS: Record<string, { minDuration: number; maxDuration: number; resolutions: string[] }> = {
  'bytedance/seedance-2.0': { minDuration: 1, maxDuration: 15, resolutions: ['480p', '720p'] },
  'bytedance/seedance-2.5': { minDuration: 4, maxDuration: 30, resolutions: ['480p', '720p', '1080p'] },
  'kwaivgi/kling-v3-video': { minDuration: 3, maxDuration: 15, resolutions: ['720p', '1080p'] },
  'google/veo-3.1-fast': { minDuration: 4, maxDuration: 8, resolutions: ['720p', '1080p', '4K'] },
  'bytedance/seedance-2.0-mini': { minDuration: 4, maxDuration: 15, resolutions: ['480p', '720p'] },
  'minimax/hailuo-3-max': { minDuration: 5, maxDuration: 15, resolutions: ['480p', '768p'] },
  'black-forest-labs/flux-3-video': { minDuration: 5, maxDuration: 20, resolutions: ['720p', '1080p'] },
};

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

    // Audit H-1: only the models the app offers, with that model's own durations/resolutions.
    const { model } = params;
    const aspectRatio = validRatio(params.aspectRatio, '16:9');
    const meta = typeof model === 'string' ? VIDEO_MODEL_LIMITS[model] : undefined;
    if (!meta) throw badRequest('Unknown model.');
    const resolution = meta.resolutions.includes(params.resolution) ? params.resolution : meta.resolutions[0];
    const requested = Number.isFinite(params.duration) && params.duration > 0 ? params.duration : 5;
    const duration = Math.min(meta.maxDuration, Math.max(meta.minDuration, Math.round(requested)));
    const prompt = clipText(params.prompt, 4000);
    const image = isImageRef(params.image) ? params.image : undefined;

    const costUsd = estimateVideoCost(model, resolution, duration);
    reservation = await reserveSpend(caller.id, model, 'video', costUsd);

    const input = buildVideoInput(model, prompt, image, aspectRatio, duration, resolution);
    const job = await submitOpenRouterVideoJob(input);
    const completed = await pollOpenRouterVideoJob(job.id);
    const url = await downloadAndStoreVideo(completed.id ?? job.id);
    const realCostUsd = typeof completed.usage?.cost === 'number' ? completed.usage.cost : null;

    await settleSpend(reservation, caller.email, realCostUsd ?? costUsd);
    reservation = null;
    return jsonResponse([url]);
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось сгенерировать видео. Попробуйте ещё раз.');
  }
});
