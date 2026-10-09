// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-vector" → paste this file → Deploy.
//
// Leave "Verify JWT" ON (the default) — that's what stops anonymous callers from using your
// paid API credits; only requests carrying a valid logged-in user's Supabase session token
// reach this code.
//
// After deploying, set one secret (Edge Functions → generate-vector → Secrets):
//   OPENROUTER_API_KEY — your OpenRouter token (openrouter.ai/settings/keys)
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// Every call is funded by the single shared OPENROUTER_API_KEY, but each user may only spend their
// own monthly allowance: the spend guard below reserves the cost before the provider call and
// settles it into generation_log afterwards. Requires supabase/migrations/
// 202610010001_generation_guard.sql (and the generation_log table — see admin-list-generations).

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
// Our internal model id 'recraft-ai/recraft-v4-svg' predates this migration; OpenRouter fronts
// the same model under its own slug, remapped only here.
const OPENROUTER_VECTOR_MODEL = 'recraft/recraft-v4-vector';

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
    model: OPENROUTER_VECTOR_MODEL,
    prompt,
    aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '4:3', '3:2', '16:9', '9:16']),
  };
}

// Returns both the generated URLs and, when OpenRouter reports it, the ACTUAL dollar amount
// charged for this call (data.usage.cost) — preferred over RECRAFT_V4_SVG_PRICE_USD's estimate
// whenever present, since the estimate can drift from OpenRouter's real rate.
async function callOpenRouterImage(
  input: Record<string, unknown>
): Promise<{ urls: string[]; realCostUsd: number | null }> {
  const res = await fetch(OPENROUTER_IMAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, usage: { include: true } }),
  });
  if (!res.ok) throw new Error(`OpenRouter images error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const items: { b64_json?: string; media_type?: string; url?: string }[] = data.data ?? [];
  const urls = items.map((item) =>
    item.url ? item.url : `data:${item.media_type ?? 'image/svg+xml'};base64,${item.b64_json ?? ''}`
  );
  const realCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
  return { urls, realCostUsd };
}

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

    reservation = await reserveSpend(req, caller.id, 'recraft-ai/recraft-v4-svg', 'vector', RECRAFT_V4_SVG_PRICE_USD);

    const input = buildVectorInput(clipText(params.prompt, 4000), validRatio(params.aspectRatio, '1:1'));
    const { urls, realCostUsd } = await callOpenRouterImage(input);

    await settleSpend(reservation, caller.email, realCostUsd ?? RECRAFT_V4_SVG_PRICE_USD);
    reservation = null;
    return jsonResponse(urls);
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось сгенерировать вектор. Попробуйте ещё раз.');
  }
});
