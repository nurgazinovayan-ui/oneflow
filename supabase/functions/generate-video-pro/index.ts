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

// The completed job object includes usage.cost when OpenRouter reports it — the ACTUAL dollar
// amount charged for this generation, preferred over SEEDANCE_25_RATES' estimate.
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
  quota_exceeded: [402, 'Недостаточно кредитов — пополните баланс.'],
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

    const resolution = ['480p', '720p', '1080p'].includes(params.resolution) ? params.resolution : '720p';
    const requested = Number.isFinite(params.duration) && params.duration > 0 ? params.duration : 5;
    const duration = Math.min(30, Math.max(4, Math.round(requested)));
    const media = (v: unknown, max: number) =>
      Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= MAX_IMAGE_REF_CHARS && (x.startsWith('https://') || x.startsWith('data:'))).slice(0, max) : [];
    const images = media(params.images, 9);
    const videos = media(params.videos, 3);
    const audios = media(params.audios, 3);

    const costUsd = estimateVideoCost(resolution, duration);
    reservation = await reserveSpend(caller.id, VIDEO_MODEL, 'video', costUsd);

    const input: Record<string, unknown> = {
      model: VIDEO_MODEL,
      prompt: clipText(params.prompt, 4000),
      aspect_ratio: mapToSupportedRatio(validRatio(params.aspectRatio, '16:9'), ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']),
      duration,
      resolution,
    };
    if (images.length) input.images = images;
    if (videos.length) input.videos = videos;
    if (audios.length) input.audios = audios;

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
