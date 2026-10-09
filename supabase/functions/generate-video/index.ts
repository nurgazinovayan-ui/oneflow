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
  const res = await fetchWithTimeout(OPENROUTER_VIDEOS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  }, 30_000);
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
const POLL_INTERVAL_MS = Number(Deno.env.get('VIDEO_POLL_INTERVAL_MS') ?? 5000);

// The completed job object includes usage.cost when OpenRouter reports it — the ACTUAL dollar
// amount charged for this generation, preferred over VIDEO_PRICE_PER_SECOND_USD's estimate.
interface CompletedVideoJob {
  id: string;
  usage?: { cost?: number };
}

// Video jobs outlive an Edge Function request (its wall-clock limit), so they are asynchronous
// (audit F-02). The first call reserves, submits and marks the reservation "submitted": from then
// on the provider bills us, so that budget is never released automatically. It then waits up to
// SYNC_WAIT_MS; an unfinished job answers 202 {pending, jobId} and the app polls with {jobId}.
// Only the account that started a job can poll it, and exactly one poller downloads, stores and
// settles it (claim_generation_completion).
const SYNC_WAIT_MS = Number(Deno.env.get('VIDEO_SYNC_WAIT_MS') ?? 100_000);
const RESUME_WAIT_MS = Number(Deno.env.get('VIDEO_RESUME_WAIT_MS') ?? 25_000);

interface ProviderVideoState {
  status: string;
  id?: string;
  usage?: { cost?: number };
  error?: unknown;
}
type VideoCaller = { id: string; email: string };

async function pollOpenRouterVideoOnce(jobId: string): Promise<ProviderVideoState> {
  try {
    const res = await fetchWithTimeout(
      `${OPENROUTER_VIDEOS_URL}/${encodeURIComponent(jobId)}`,
      { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } },
      20_000
    );
    if (!res.ok) {
      console.error('video poll error', res.status, (await res.text()).slice(0, 300));
      return { status: 'unknown' };
    }
    return await res.json();
  } catch (err) {
    console.error('video poll failed', err);
    return { status: 'unknown' }; // network trouble is not a provider failure: keep waiting
  }
}

async function finishOrPending(caller: VideoCaller, reservation: string, providerJobId: string, deadline: number): Promise<Response> {
  for (;;) {
    const state = await pollOpenRouterVideoOnce(providerJobId);
    if (state.status === 'completed') return await completeVideoJob(caller, reservation, providerJobId, state);
    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'expired') {
      console.error('video job ended', state.status, state.error);
      // the provider does not bill jobs that failed on its side
      const { error } = await supabaseAdmin.rpc('release_generation', { p_reservation: reservation });
      if (error) console.error('release_generation failed', error);
      return jsonResponse({ error: 'Не удалось сгенерировать видео. Попробуйте ещё раз.', code: 'job_failed' }, 502);
    }
    if (Date.now() + POLL_INTERVAL_MS > deadline) return jsonResponse({ pending: true, jobId: reservation }, 202);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function completeVideoJob(caller: VideoCaller, reservation: string, providerJobId: string, state: ProviderVideoState): Promise<Response> {
  const { data: claimed, error } = await supabaseAdmin.rpc('claim_generation_completion', { p_reservation: reservation, p_user: caller.id });
  if (error) throw error;
  if (!claimed) return jsonResponse({ pending: true, jobId: reservation }, 202); // another poller is finishing it
  try {
    const url = await downloadAndStoreVideo(state.id ?? providerJobId);
    const realCostUsd = typeof state.usage?.cost === 'number' ? state.usage.cost : null;
    await settleSpend(reservation, caller.email, realCostUsd, { urls: [url] });
    return jsonResponse([url]);
  } catch (err) {
    // hand the job back, so the next poll retries the download instead of waiting ten minutes
    await supabaseAdmin
      .from('generation_reservations')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', reservation)
      .eq('status', 'finishing');
    throw err;
  }
}

async function resumeVideoJob(caller: VideoCaller, jobId: unknown): Promise<Response> {
  await rateLimit(`video-poll:${caller.id}`, 120, 60, false);
  const job = await loadOwnedJob(caller.id, jobId);
  if (!job) return jsonResponse({ error: 'Задача не найдена.', code: 'not_found' }, 404);
  if (job.status === 'settled') {
    const urls = (job.result as { urls?: string[] } | null)?.urls;
    return urls ? jsonResponse(urls) : jsonResponse({ error: 'Результат больше недоступен.', code: 'job_gone' }, 410);
  }
  if (job.status === 'released' || job.status === 'expired') {
    return jsonResponse({ error: 'Не удалось сгенерировать видео. Попробуйте ещё раз.', code: 'job_failed' }, 502);
  }
  if (!job.provider_job_id) return jsonResponse({ pending: true, jobId: job.id }, 202);
  return await finishOrPending(caller, job.id, job.provider_job_id, Date.now() + RESUME_WAIT_MS);
}

async function downloadAndStoreVideo(jobId: string): Promise<string> {
  const res = await fetchWithTimeout(`${OPENROUTER_VIDEOS_URL}/${encodeURIComponent(jobId)}/content?index=0`, {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
  }, 90_000);
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

// ---- Spend guard v2 — generated from supabase/functions/_shared/paid_guard.ts by
// scripts/sync-edge-guard.mjs. Edit that file and re-run the script; do not edit this copy by hand
// (every paid function deploys as one pasted file, so the block is copied into each of them).
//
// Every paid call goes through reserve_generation_v2 (supabase/migrations/202610090001_security_
// hardening.sql) BEFORE the provider is called. That one database call checks the kill switch,
// e-mail confirmation, the single-job ceiling, the Idempotency-Key, per-account and per-IP rates,
// parallel jobs, the global / per-account / organisation spend caps and the credits. After the call
// the reservation is settled with the real cost (once), or released if the provider failed.
// Refusals map to stable codes the app translates (src/webApi.ts callFunction).
class GuardError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}
const GUARD_ERRORS: Record<string, [number, string]> = {
  email_not_confirmed: [403, 'Подтвердите email, чтобы пользоваться генерацией.'],
  quota_exceeded: [402, 'Недостаточно кредитов — пополните баланс.'],
  too_many_jobs: [429, 'Слишком много генераций одновременно — дождитесь завершения.'],
  job_too_expensive: [400, 'Запрос слишком дорогой для одной генерации.'],
  rate_limited: [429, 'Слишком много запросов. Подождите минуту.'],
  spend_limit: [429, 'Достигнут лимит расходов. Попробуйте позже.'],
  service_paused: [503, 'Генерация временно приостановлена. Попробуйте позже.'],
  account_blocked: [403, 'Генерация для этого аккаунта приостановлена. Напишите в поддержку.'],
  bad_idempotency_key: [400, 'Bad request.'],
  bad_amount: [400, 'Bad request.'],
};
const badRequest = (message: string) => new GuardError(400, 'bad_request', message);

// Request bodies carry reference images as data URLs, so the ceiling is generous but finite.
const MAX_BODY_BYTES = 48 * 1024 * 1024;
async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, any>> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new GuardError(413, 'payload_too_large', 'Запрос слишком большой.');
  const text = await req.text().catch(() => '');
  if (text.length > maxBytes) throw new GuardError(413, 'payload_too_large', 'Запрос слишком большой.');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fall through
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw badRequest('Bad request.');
  return parsed as Record<string, any>;
}

// The client address as seen by the platform proxy. cf-connecting-ip / x-real-ip are set by the
// proxy itself; in x-forwarded-for only the LAST hop was added by the proxy (anything before it can
// be typed by the client), so that is the one used. Stored only as a salted hash.
async function clientIpHash(req: Request): Promise<string | null> {
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? xff[xff.length - 1] ?? '';
  if (!ip || ip.length > 64) return null;
  const salt = Deno.env.get('IP_HASH_SALT') ?? Deno.env.get('SUPABASE_URL') ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return Array.from(new Uint8Array(digest).slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Optional Idempotency-Key header (src/webApi.ts sends one per call): a retried request with the
// same key never starts a second paid job.
function idempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key');
  if (!key) return null;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw badRequest('Bad Idempotency-Key.');
  return key;
}

// Spend alerts are journaled in security_events by the database; this only pings an optional
// webhook (ALERT_WEBHOOK_URL, e.g. a Slack/Telegram relay) with no user data and no secrets.
function notifyAlert(kind: string, fn: string): void {
  const url = Deno.env.get('ALERT_WEBHOOK_URL') ?? '';
  if (!url.startsWith('https://')) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `ONEFLOW spend alert: ${kind} (function ${fn}). See security_events.` }),
  }).catch(() => {});
}

const functionName = (req: Request) => new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? 'unknown';

async function reserveSpend(req: Request, userId: string, model: string, category: string, amountUsd: number): Promise<string> {
  const fn = functionName(req);
  const { data, error } = await supabaseAdmin.rpc('reserve_generation_v2', {
    p_user: userId,
    p_model: model,
    p_category: category,
    p_amount: Math.max(0, Number(amountUsd) || 0),
    p_idempotency_key: idempotencyKey(req),
    p_function: fn,
    p_ip_hash: await clientIpHash(req),
  });
  // Fail closed: if the gate itself is unavailable, nothing paid runs.
  if (error || !data || typeof data !== 'object') {
    console.error('reserve_generation_v2 failed', error);
    throw new GuardError(503, 'guard_unavailable', 'Сервис временно недоступен. Попробуйте позже.');
  }
  const r = data as { id?: string; replay?: boolean; status?: string; error?: string; retry_after?: number; alert?: string };
  if (r.error) {
    const [status, message] = GUARD_ERRORS[r.error] ?? [400, 'Bad request.'];
    throw new GuardError(status, r.error, message, r.retry_after ? { retryAfter: r.retry_after } : {});
  }
  if (r.replay) {
    throw new GuardError(409, 'duplicate_request', 'Этот запрос уже выполняется или выполнен.', { jobId: r.id, jobStatus: r.status });
  }
  if (r.alert) notifyAlert(r.alert, fn);
  return r.id as string;
}

async function settleSpend(reservation: string | null, email: string, costUsd: number | null, result: unknown = null): Promise<void> {
  if (!reservation) return;
  const cost = Number.isFinite(costUsd) && (costUsd as number) >= 0 ? costUsd : null;
  const { error } = await supabaseAdmin.rpc('settle_generation', { p_reservation: reservation, p_email: email, p_cost: cost, p_result: result });
  if (error) console.error('settle_generation failed', error);
}

// Async provider jobs (video): once the provider accepted the job it bills us, so the budget is held
// until the job resolves — the reservation is never auto-released after this point.
async function markSubmitted(reservation: string, providerJobId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('mark_generation_submitted', { p_reservation: reservation, p_provider_job: providerJobId });
  if (error) console.error('mark_generation_submitted failed', error);
}

// Generic distributed limiter (rate_limit_hit in Postgres, shared by every function instance).
// Throws 429 with Retry-After when over the limit. failClosed: a broken limiter refuses the request
// (paid paths) instead of letting it through (cheap, read-only paths log and continue).
async function rateLimit(bucket: string, limit: number, windowSeconds: number, failClosed: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('rate_limit_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error('rate_limit_hit failed', error);
    if (failClosed) throw new GuardError(503, 'guard_unavailable', 'Сервис временно недоступен. Попробуйте позже.');
    return;
  }
  if (Number(data) > 0) throw new GuardError(429, 'rate_limited', GUARD_ERRORS.rate_limited[1], { retryAfter: Number(data) });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface OwnedJob { id: string; status: string; provider_job_id: string | null; amount_usd: number; result: unknown; model: string }
// A job is only ever visible to the account that started it (the id alone grants nothing).
async function loadOwnedJob(userId: string, jobId: unknown): Promise<OwnedJob | null> {
  if (typeof jobId !== 'string' || !UUID_RE.test(jobId)) return null;
  const { data, error } = await supabaseAdmin
    .from('generation_reservations')
    .select('id, status, provider_job_id, amount_usd, result, model')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as OwnedJob | null) ?? null;
}

// Releases an unsettled reservation and turns any error into a response without internal details
// (the details go to the function logs).
async function failResponse(err: unknown, reservation: string | null, message: string): Promise<Response> {
  if (reservation) {
    const { error } = await supabaseAdmin.rpc('release_generation', { p_reservation: reservation });
    if (error) console.error('release_generation failed', error);
  }
  if (err instanceof GuardError) {
    const headers: Record<string, string> = {};
    if (typeof err.extra.retryAfter === 'number') headers['Retry-After'] = String(err.extra.retryAfter);
    const { retryAfter: _r, ...rest } = err.extra;
    return jsonResponse({ error: err.message, code: err.code, ...rest }, err.status, headers);
  }
  console.error(err);
  return jsonResponse({ error: message }, 500);
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

// Reference media handed to providers: image data URLs, or https URLs that point at a public host —
// never credentials in the URL, an IP literal, localhost, a private/link-local/metadata range or an
// internal name. Providers fetch these, not us, but they must not be steerable at internal targets.
const MAX_IMAGE_REF_CHARS = 12_000_000;
function isPublicHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 4096) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) return false;
  if (host === 'metadata.google.internal' || host.endsWith('.svc') || host.endsWith('.cluster.local')) return false;
  return true;
}
const isImageRef = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_IMAGE_REF_CHARS && (v.startsWith('data:image/') || isPublicHttpsUrl(v));
const isMediaRef = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_IMAGE_REF_CHARS && (/^data:(image|video|audio)\//.test(v) || isPublicHttpsUrl(v));
const clipText = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const validRatio = (v: unknown, fallback: string): string => (typeof v === 'string' && /^\d{1,2}:\d{1,2}$/.test(v) ? v : fallback);
// Provider calls never hang the function: every fetch to a provider has a deadline.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
// ---- end of spend guard

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let reservation: string | null = null;
  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: 'Not authenticated.' }, 401);
    const params = await readJsonBody(req);
    if (params.jobId !== undefined) return await resumeVideoJob(caller, params.jobId);

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
    reservation = await reserveSpend(req, caller.id, model, 'video', costUsd);

    const input = buildVideoInput(model, prompt, image, aspectRatio, duration, resolution);
    const job = await submitOpenRouterVideoJob(input);
    if (typeof job?.id !== 'string' || !job.id) throw new Error('OpenRouter video submit returned no job id');
    await markSubmitted(reservation, job.id);
    const submitted = reservation;
    reservation = null; // the provider bills from here on: this budget is never released automatically
    return await finishOrPending(caller, submitted, job.id, Date.now() + SYNC_WAIT_MS);
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось сгенерировать видео. Попробуйте ещё раз.');
  }
});
