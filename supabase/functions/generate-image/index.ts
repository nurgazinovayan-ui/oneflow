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
// Every call is funded by the single shared OPENROUTER_API_KEY, but each user may only spend their
// own monthly allowance: the spend guard below reserves the cost before the provider call and
// settles it into generation_log afterwards. Requires supabase/migrations/
// 202610010001_generation_guard.sql (and the generation_log table — see admin-list-generations).

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
  // Nano Banana 2.1 (Flash tier, released 2026-10-06) — OpenRouter lists it under its own name
  'google/nano-banana-2.1': 'google/gemini-nano-banana-2.1',
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
  // $30 per 1M image-output tokens (1K ≈ 1120, 2K ≈ 1680, 4K ≈ 2520 tokens); the real per-call
  // cost from OpenRouter (usage.cost) is still preferred when it comes back
  'google/nano-banana-2.1': { '1K': 0.0336, '2K': 0.0504, '4K': 0.0756 },
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
    'google/nano-banana-2.1': ['1:1', '3:4', '4:3', '9:16', '16:9'],
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

// Returns both the generated URLs and, when OpenRouter reports it, the ACTUAL dollar amount
// charged for this specific call (data.usage.cost) — the real per-provider price, not our
// hand-maintained IMAGE_PRICE_USD estimate. settleSpend below prefers this over the estimate
// whenever it's present, since the estimate table can drift from OpenRouter's real rates.
async function callOpenRouterImage(
  input: Record<string, unknown>
): Promise<{ urls: string[]; realCostUsd: number | null }> {
  // a hung provider call must not outlive the function: abort before the platform kills it
  const res = await fetchWithTimeout(OPENROUTER_IMAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...input, usage: { include: true } }),
  }, 130_000);
  if (!res.ok) throw new Error(`OpenRouter images error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const items: { b64_json?: string; media_type?: string; url?: string }[] = data.data ?? [];
  const urls = items.map((item) =>
    item.url ? item.url : `data:${item.media_type ?? 'image/png'};base64,${item.b64_json ?? ''}`
  );
  const realCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
  return { urls, realCostUsd };
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
      return await replicate.run(model as `${string}/${string}`, { input });
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

// Replicate utility tools (Инструменты → Удалить фон / Апскейлер): flat estimates for the budget.
const UTILITY_PRICE_USD: Record<string, number> = { '851-labs/background-remover': 0.01, 'nightmareai/real-esrgan': 0.01 };

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

    // Audit H-1: only the models the app offers (the price table) plus the two utility tools.
    const { model } = params;
    const aspectRatio = typeof params.aspectRatio === 'string' && /^\d{1,2}:\d{1,2}$/.test(params.aspectRatio) ? params.aspectRatio : '1:1';
    if (typeof model !== 'string' || !(model in IMAGE_PRICE_USD || model in UTILITY_PRICE_USD)) throw badRequest('Unknown model.');
    // The price is looked up by resolution, so the resolution sent to the provider must be one of the
    // priced tiers of THIS model — otherwise a 4K request could be reserved at the 1K price (audit F-01).
    // Flat-priced models never get a resolution at all.
    const priceEntry = IMAGE_PRICE_USD[model];
    let resolution: string | undefined;
    if (priceEntry !== undefined && typeof priceEntry === 'object') {
      if (params.resolution === undefined || params.resolution === null || params.resolution === '') resolution = Object.keys(priceEntry)[0];
      else if (typeof params.resolution === 'string' && Object.hasOwn(priceEntry, params.resolution)) resolution = params.resolution;
      else throw badRequest('Unsupported resolution for this model.');
    }
    const prompt = clipText(params.prompt, 4000);
    const image = isImageRef(params.image) ? params.image : undefined;
    const images = Array.isArray(params.images) ? params.images.filter(isImageRef).slice(0, 8) : undefined;
    const size = (v: unknown) => (Number.isFinite(v) ? Math.min(4096, Math.max(16, Number(v))) : undefined);
    const width = size(params.width);
    const height = size(params.height);

    const costUsd = UTILITY_PRICE_USD[model] ?? estimateImageCost(model, resolution);
    reservation = await reserveSpend(req, caller.id, model, 'image', costUsd);

    let urls: string[];
    let realCostUsd: number | null = null;
    if (REPLICATE_ONLY_IMAGE_MODELS.has(model)) {
      const input = buildImageInput(model, prompt, aspectRatio, image, width, height);
      const replicate = new Replicate({ auth: REPLICATE_API_KEY });
      const output = await runReplicateWithRetry(replicate, model, input);
      urls = normalizeOutput(output);
    } else {
      const input = buildOpenRouterImageInput(model, prompt, aspectRatio, image, images, resolution, width, height);
      const result = await callOpenRouterImage(input);
      urls = result.urls;
      realCostUsd = result.realCostUsd;
    }

    await settleSpend(reservation, caller.email, realCostUsd ?? costUsd);
    reservation = null;
    return jsonResponse(urls);
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось сгенерировать изображение. Попробуйте ещё раз.');
  }
});
