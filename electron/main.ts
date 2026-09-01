import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import Store from 'electron-store';
import Replicate from 'replicate';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './authConfig';
import { LEMONSQUEEZY_CHECKOUT_URL } from './paymentConfig';

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresAt: number;
}

interface GenerationLogEntry {
  timestamp: number;
  model: string;
  category: 'image' | 'video' | 'adapt' | 'vector';
  costUsd: number;
}

interface StoreSchema {
  apiKey?: string;
  generationLimit?: number;
  generationUsage?: { month: string; costUsd: number };
  generationLog?: GenerationLogEntry[];
  authSession?: AuthSession;
  // Whether the last successful login asked to stay signed in across launches. authSession
  // itself is still cleared on every launch UNLESS this is true — see tryAutoLogin.
  rememberMe?: boolean;
  // Admin messages already shown to this install — messages aren't deleted server-side (so
  // the admin keeps a record), so this is what keeps them from popping up again on every poll.
  seenAdminMessageIds?: string[];
}

const store = new Store<StoreSchema>();

function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

async function supabaseLogin(
  email: string,
  password: string
): Promise<{ ok: true; session: AuthSession } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error_description || data?.msg || 'Неверный логин или пароль.',
      };
    }
    const session: AuthSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user?.id,
      email,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    store.set('authSession', session);
    return { ok: true, session };
  } catch (err) {
    console.error('Supabase login request failed', err);
    return { ok: false, error: 'Не удалось связаться с сервером авторизации.' };
  }
}

// Self-service registration ("Регистрация" button on the login panel). Unlike supabaseLogin,
// success here doesn't necessarily mean the account can log in yet — if the Supabase project
// has "Confirm email" enabled, signup returns 200 with no session until the user clicks the
// emailed confirmation link. needsConfirmation reflects that so splash.html can show the right
// message instead of unconditionally claiming the account is ready to use.
async function supabaseRegister(
  email: string,
  password: string
): Promise<{ ok: true; needsConfirmation: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error:
          data?.error_description || data?.msg || data?.error?.message || 'Не удалось зарегистрироваться.',
      };
    }
    return { ok: true, needsConfirmation: !data?.access_token };
  } catch (err) {
    console.error('Supabase registration request failed', err);
    return { ok: false, error: 'Не удалось связаться с сервером авторизации.' };
  }
}

async function refreshAuthSession(session: AuthSession): Promise<AuthSession | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const next: AuthSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: session.userId,
      email: session.email,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    store.set('authSession', next);
    return next;
  } catch (err) {
    console.error('Supabase session refresh failed', err);
    return null;
  }
}

async function getValidSession(): Promise<AuthSession | null> {
  if (!isAuthConfigured()) return null;
  const session = store.get('authSession');
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session;
  return refreshAuthSession(session);
}

function isPaymentConfigured(): boolean {
  return Boolean(LEMONSQUEEZY_CHECKOUT_URL);
}

function buildCheckoutUrl(email: string, userId: string): string {
  const url = new URL(LEMONSQUEEZY_CHECKOUT_URL);
  url.searchParams.set('checkout[email]', email);
  url.searchParams.set('checkout[custom][user_id]', userId);
  return url.toString();
}

// Subscription status lives in a `subscriptions` table in the same Supabase project,
// written only by the Edge Function that verifies LemonSqueezy's webhooks — the client never
// writes it directly, only reads its own row (enforced by Row Level Security).
async function fetchSubscriptionRow(
  session: AuthSession
): Promise<{ status: string; current_period_end: string | null } | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${session.userId}&select=status,current_period_end`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows: { status: string; current_period_end: string | null }[] = await res.json();
  return rows[0] ?? null;
}

async function isSubscriptionActive(session: AuthSession): Promise<boolean> {
  if (!isPaymentConfigured()) return true;
  try {
    const row = await fetchSubscriptionRow(session);
    if (!row) return false;
    // LemonSqueezy subscription statuses: on_trial, active, paused, past_due, unpaid,
    // cancelled, expired.
    const isActiveStatus = row.status === 'active' || row.status === 'on_trial';
    const notExpired =
      !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now();
    return isActiveStatus && notExpired;
  } catch (err) {
    console.error('Subscription status check failed', err);
    return false;
  }
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// stored.costUsd can be missing/non-numeric for users upgrading from the older
// count-based budget tracking, which persisted the same store key with a { month, count }
// shape — guard against that instead of trusting the type.
function storedCostUsd(stored: { month: string; costUsd: number } | undefined, month: string): number {
  if (!stored || stored.month !== month) return 0;
  return typeof stored.costUsd === 'number' && Number.isFinite(stored.costUsd) ? stored.costUsd : 0;
}

function getUsage(): { costUsd: number; limit: number; month: string } {
  const month = currentMonthKey();
  const stored = store.get('generationUsage');
  const limitRaw = store.get('generationLimit');
  const limit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : 50;
  return { costUsd: storedCostUsd(stored, month), limit, month };
}

function bumpUsage(costUsd: number): void {
  const month = currentMonthKey();
  const stored = store.get('generationUsage');
  const total = storedCostUsd(stored, month) + costUsd;
  store.set('generationUsage', { month, costUsd: total });
}

// Per-generation history behind the profile popup's "count by model, exportable by date"
// view. Capped so the store file can't grow unbounded over years of use.
const GENERATION_LOG_MAX_ENTRIES = 10000;

function logGeneration(entry: GenerationLogEntry): void {
  const log = store.get('generationLog') ?? [];
  log.push(entry);
  if (log.length > GENERATION_LOG_MAX_ENTRIES) {
    log.splice(0, log.length - GENERATION_LOG_MAX_ENTRIES);
  }
  store.set('generationLog', log);
}

// Replicate has no API that returns a prediction's real dollar cost — these are the
// per-model rates Replicate publishes on each model's own pricing page, captured by hand.
// Nano Banana Pro/2 and GPT Image 2 bill per output image at a rate that depends on
// resolution/quality; the video models bill per second of output at a rate that depends on
// resolution. If Replicate changes a model's price, update the matching entry here.
const IMAGE_PRICE_USD: Record<string, Record<string, number> | number> = {
  'google/nano-banana-pro': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'google/nano-banana-2': { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  'openai/gpt-image-2': { auto: 0.08, low: 0.006, medium: 0.053, high: 0.211 },
  'recraft-ai/recraft-v4-svg': 0.08,
};

const VIDEO_PRICE_PER_SECOND_USD: Record<string, Record<string, number>> = {
  'bytedance/seedance-2.0': { '480p': 0.15, '720p': 0.3 },
  'bytedance/seedance-2.5': { '480p': 0.11, '720p': 0.24, '1080p': 0.4 },
  'kwaivgi/kling-v3-video': { '720p': 0.126, '1080p': 0.168 },
};

function estimateImageCost(model: string, resolution: string | undefined, outputCount: number): number {
  const entry = IMAGE_PRICE_USD[model];
  if (entry === undefined) return 0;
  const perImage =
    typeof entry === 'number' ? entry : (resolution && entry[resolution]) || Object.values(entry)[0];
  return perImage * Math.max(1, outputCount);
}

function estimateVideoCost(model: string, resolution: string, duration: number): number {
  const rates = VIDEO_PRICE_PER_SECOND_USD[model];
  if (!rates) return 0;
  const perSecond = rates[resolution] ?? Object.values(rates)[0];
  return perSecond * Math.max(1, duration);
}

type ArchiveCategory = 'image' | 'video' | 'adapt' | 'vector';

interface ArchiveEntry {
  fileName: string;
  category: ArchiveCategory;
  savedAt: number;
  url: string;
}

function projectArchiveFolder(projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(app.getPath('userData'), 'projects', safeId, 'generations');
}

async function downloadToBuffer(url: string): Promise<{ buffer: Buffer; ext: string }> {
  if (url.startsWith('data:')) {
    // The media-type segment can carry extra `;charset=...`-style parameters before the
    // `;base64` flag (e.g. `data:text/csv;charset=utf-8;base64,...`) — match up to the
    // LAST `;base64,` rather than assuming it's the only parameter present.
    const match = /^data:([^,]*);base64,([\s\S]*)$/.exec(url);
    if (!match) throw new Error('Invalid data URL');
    const mime = match[1].split(';')[0];
    const buffer = Buffer.from(match[2], 'base64');
    const ext = (mime.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    return { buffer, ext };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  let ext = 'bin';
  if (contentType.includes('png')) ext = 'png';
  else if (contentType.includes('jpeg')) ext = 'jpg';
  else if (contentType.includes('webp')) ext = 'webp';
  else if (contentType.includes('mp4')) ext = 'mp4';
  else if (contentType.includes('svg')) ext = 'svg';
  else {
    const urlExt = path.extname(new URL(url).pathname).replace('.', '');
    if (urlExt) ext = urlExt;
  }
  return { buffer, ext };
}

async function saveToArchive(
  projectId: string,
  category: ArchiveCategory,
  urls: string[]
): Promise<void> {
  const folder = projectArchiveFolder(projectId);
  fs.mkdirSync(folder, { recursive: true });
  for (const url of urls) {
    try {
      const { buffer, ext } = await downloadToBuffer(url);
      const fileName = `${Date.now()}-${category}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      fs.writeFileSync(path.join(folder, fileName), buffer);
    } catch (err) {
      console.error('archive save failed', err);
    }
  }
}

function listArchive(projectId: string): ArchiveEntry[] {
  const folder = projectArchiveFolder(projectId);
  if (!fs.existsSync(folder)) return [];
  const files = fs.readdirSync(folder);
  return files
    .map((fileName): ArchiveEntry => {
      const match = /^(\d+)-(image|video|adapt|vector)-/.exec(fileName);
      const filePath = path.join(folder, fileName);
      return {
        fileName,
        category: (match?.[2] as ArchiveCategory) ?? 'image',
        savedAt: match ? Number(match[1]) : fs.statSync(filePath).mtimeMs,
        url: pathToFileURL(filePath).toString(),
      };
    })
    .sort((a, b) => b.savedAt - a.savedAt);
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let dspWindow: BrowserWindow | null = null;

function getReplicate(): Replicate {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    throw new Error('Replicate API key is not set. Open Settings and add your token.');
  }
  return new Replicate({ auth: apiKey });
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
  model: `${string}/${string}`,
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

// Kept in sync by hand with src/types.ts (separate compile roots for main vs renderer).
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
  // Ordered reference-image slots take priority; fall back to the single legacy `image`.
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

  // Flux Kontext takes explicit pixel width/height (rounded to a multiple of 32) instead
  // of a fixed aspect-ratio enum, so it can target an arbitrary user-entered size directly.
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
  // Nano Banana Pro (Gemini 3 image model) accepts up to 14 ordered reference images.
  // It's a very high-demand model and frequently returns ModelRateLimitError when
  // Replicate's backing capacity is saturated. allow_fallback_model used to be enabled here
  // so Replicate could silently swap in bytedance/seedream-5 instead of failing outright —
  // but seedream-5 takes a "size" field, not "resolution", so it silently ignored the
  // requested 1K/2K/4K and always rendered at its own default, regardless of the user's
  // choice. Left off now: a saturated model surfaces as a retriable rate-limit error instead
  // (handled by runReplicateWithRetry's backoff + the "try again" message in the UI), which
  // is better than quietly generating the wrong resolution.
  if (model === 'google/nano-banana-pro') {
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '3:4', '4:3', '9:16', '16:9']),
    };
    if (refImages) input.image_input = refImages;
    if (resolution) input.resolution = resolution;
    return input;
  }
  // Nano Banana 2 (Gemini image model) takes aspect_ratio instead of raw pixel dimensions.
  if (model === 'google/nano-banana-2') {
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '16:9', '9:16']),
    };
    if (refImages) input.image_input = refImages;
    if (resolution) input.resolution = resolution;
    return input;
  }
  // GPT Image 2 only supports 1:1 / 3:2 / 2:3 aspect ratios, no raw pixel dimensions.
  // It has no raw resolution knob — "resolution" maps to its "quality" tier instead.
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

// "Вектор" node — Recraft V4 SVG. Exact enum casing for aspect_ratio isn't published in a
// machine-readable schema; mapped onto the same aspect-ratio set already used elsewhere.
function buildVectorInput(prompt: string, aspectRatio: string): Record<string, unknown> {
  return {
    prompt,
    aspect_ratio: mapToSupportedRatio(aspectRatio, ['1:1', '4:3', '3:2', '16:9', '9:16']),
  };
}

function buildVideoInput(
  model: string,
  prompt: string,
  image: string | undefined,
  aspectRatio: string,
  duration: number,
  resolution: string
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt };
  if (image) {
    input.image = image;
  }

  // When an input image is provided, the model derives the frame/aspect ratio from it
  // (image-to-video mode) — sending an explicit aspect_ratio/width/height alongside it
  // conflicts with several models' APIs, so it's only sent for pure text-to-video.
  const isImageToVideo = Boolean(image);

  if (model.startsWith('bytedance/seedance')) {
    if (!isImageToVideo) {
      input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
    }
    input.duration = Math.round(duration);
    input.resolution = resolution;
    return input;
  }
  // Kling 3.0 takes a "standard"/"pro" mode instead of a raw resolution string; the UI's
  // 720p/1080p selector maps onto it. aspect_ratio is ignored by the model once a start
  // image is supplied, same as the other image-to-video models above.
  if (model === 'kwaivgi/kling-v3-video') {
    if (!isImageToVideo) {
      input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '9:16', '1:1']);
    }
    input.duration = Math.round(duration);
    input.mode = resolution === '1080p' ? 'pro' : 'standard';
    return input;
  }
  input.duration = Math.round(duration);
  return input;
}

function normalizeOutput(output: unknown): string[] {
  const toUrl = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const anyItem = item as { url?: unknown };
      if (typeof anyItem.url === 'function') {
        const result = (anyItem.url as () => unknown)();
        return String(result);
      }
      if (typeof anyItem.url === 'string') return anyItem.url;
    }
    return String(item);
  };
  if (Array.isArray(output)) return output.map(toUrl);
  return [toUrl(output)];
}

// LLM outputs on Replicate are typically a plain string or an array of streamed
// text chunks that concatenate (no separator) into the full response.
function normalizeChatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(String).join('');
  return String(output);
}

// Shared by both chat system prompts below — teaches the model an optional second fenced
// block for quick-reply chips the UI renders as clickable buttons (see chatSuggestions.ts).
// Kept deliberately "use sparingly" so it doesn't turn every reply into a wall of buttons.
const SUGGESTIONS_INSTRUCTIONS =
  '\n\nИногда, когда это реально ускорит диалог (ты предлагаешь несколько вариантов на выбор, ' +
  'или задаёшь уточняющий вопрос с очевидными короткими ответами), можешь добавить в самом конце ' +
  'ответа (после любого другого спецблока, если он есть) fenced-блок кода с языком ' +
  'oneflow-suggestions, содержащий JSON-массив из 2-4 коротких вариантов быстрого ответа ' +
  'пользователя на его языке, например:\n' +
  '```oneflow-suggestions\n' +
  '["Да, делай так", "Покажи другой вариант", "Нет, не нужно"]\n' +
  '```\n' +
  'Используй это не в каждом ответе, а только когда варианты действительно короткие и уместные.';

const NODE_ASSISTANT_SYSTEM_PROMPT =
  'Ты — дружелюбный ИИ-ассистент внутри desktop-приложения ONEFLOW — нод-редактора для ' +
  'генерации фото и видео через различные нейросети (Replicate). Отвечай кратко, по делу, ' +
  'на языке пользователя (по умолчанию на русском).\n\n' +
  'У тебя есть возможность самому создавать цепочки нод на холсте пользователя. Делай это ' +
  'ТОЛЬКО когда пользователь явно просит построить/создать/собрать ноды или цепочку ' +
  '(например: "собери цепочку для генерации видео из фото", "добавь ноду адаптации под Kaspi"). ' +
  'Для этого в конце своего ответа добавь один fenced-блок кода с языком oneflow-actions, ' +
  'содержащий JSON-объект вида {"actions": [...]}. Каждый элемент actions — это один из:\n' +
  '  {"type":"addNode","refId":"n1","nodeType":"prompt","data":{"value":"..."}}\n' +
  '  {"type":"addNode","refId":"n2","nodeType":"imageGen","data":{"model":"google/nano-banana-pro","aspectRatio":"1:1"}}\n' +
  '  {"type":"connect","from":"n1","to":"n2","targetHandle":"prompt"}\n' +
  'Допустимые nodeType и их data: "prompt" (data.value — текст промпта), ' +
  '"imageGen" (data.model, data.manualPrompt, data.aspectRatio), ' +
  '"videoGen" (data.model, data.manualPrompt, data.aspectRatio, data.duration, data.resolution), ' +
  '"adapt" (data.note), "imageInput" (data.manualUrl — URL картинки, если есть, иначе не указывай). ' +
  'refId — твой временный локальный id узла внутри этого JSON, нужен только для connect, ' +
  'в самом приложении узлам присваиваются другие настоящие id. ' +
  'Допустимые targetHandle для connect: у imageGen — "prompt" (источник: prompt) или ' +
  '"ref-0".."ref-6" (источник: imageGen/imageInput, до 7 референс-фото по порядку подключения); ' +
  'у videoGen — "prompt" (источник: prompt) или "image" (источник: imageGen/imageInput); ' +
  'у adapt — "image" (источник: imageGen/imageInput). ' +
  'У adapt нет выходного гнезда — из него нельзя тянуть connect. У prompt/imageGen/imageInput/videoGen ' +
  'есть ровно один источник (output), поэтому в connect достаточно указать from/to/targetHandle. ' +
  'Перед JSON-блоком коротко на русском объясни, что ты сейчас добавишь. Никогда не включай этот ' +
  'блок, если пользователь не просил явно что-то создать/добавить/собрать на холсте. Если в ответе ' +
  'есть и oneflow-suggestions, и oneflow-actions — блок oneflow-actions должен идти самым последним.' +
  SUGGESTIONS_INSTRUCTIONS;

// The general-purpose chat behind "Работа с текстом" — deliberately NOT the node-building
// assistant above: it never emits oneflow-actions, and redirects the user to the canvas's own
// ИИ ассистент if they ask it to build something there.
// Teaches the text-work chat an optional third fenced block, alongside oneflow-suggestions —
// structured content the client turns into a real .docx/.pptx client-side (see
// src/deliverables.ts), never binary output from the model itself.
const DOCUMENT_INSTRUCTIONS =
  '\n\nЕсли пользователь явно просит подготовить документ (например: договор, отчёт, статью, ' +
  'бриф, письмо) или презентацию — после краткого текстового ответа добавь fenced-блок кода с ' +
  'языком oneflow-document, содержащий JSON-объект одного из двух видов:\n' +
  'Документ: {"kind":"document","title":"...","sections":[{"heading":"...",' +
  '"paragraphs":["..."],"bullets":["..."]}]} — heading/paragraphs/bullets в каждом section ' +
  'необязательны, используй что уместно.\n' +
  'Презентация: {"kind":"presentation","title":"...","slides":[{"title":"...",' +
  '"bullets":["..."],"notes":"..."}]} — notes необязательны (заметки докладчика).\n' +
  'Заголовок и весь текст внутри — на языке пользователя, содержательные и готовые к ' +
  'использованию (не заглушки/placeholder). Не включай этот блок, если пользователь не просил ' +
  'именно документ или презентацию — обычные ответы (заголовки, идеи, короткие тексты) ' +
  'оформляй просто как обычный текст.';

const TEXT_CHAT_SYSTEM_PROMPT =
  'Ты — полноценный ИИ-ассистент общего назначения внутри раздела «Работа с текстом» desktop-' +
  'приложения ONEFLOW (программа для создания рекламных фото/видео под ad-платформы: BYYD, ' +
  'Discovery, GDN, Kaspi, РСЯ). Помогай с любыми текстовыми задачами: заголовки и описания для ' +
  'рекламы, копирайтинг, редактура, перевод, мозговой штурм идей для кампаний, а также обычные ' +
  'вопросы — как полноценный ChatGPT. Отвечай подробно и по делу, форматируй markdown\'ом ' +
  '(списки, выделение), когда это уместно, на языке пользователя (по умолчанию на русском).\n\n' +
  'Ты НЕ создаёшь и не редактируешь ноды на холсте — этим занимается отдельный ассистент. Если ' +
  'пользователь просит построить цепочку нод или что-то на холсте, вежливо объясни, что для ' +
  'этого нужно использовать кнопку «ИИ ассистент» на самом холсте, и не пытайся выполнить это сам.' +
  DOCUMENT_INSTRUCTIONS +
  SUGGESTIONS_INSTRUCTIONS;

const SPLASH_MIN_DURATION_MS = 1600;

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 640,
    height: 400,
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    show: true,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'splashPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  return splash;
}

// Hard cap on how long the splash screen is allowed to block the app. "ready-to-show" has
// been observed to occasionally never fire on some Windows setups when combined with
// titleBarOverlay — rather than hang forever, force the main window visible after this.
const SPLASH_MAX_WAIT_MS = 6000;

function createBrowserWindow(): BrowserWindow {
  const baseOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  try {
    return new BrowserWindow({
      ...baseOptions,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#E5157E', symbolColor: '#ffffff', height: 32 },
    });
  } catch (err) {
    console.error('Custom titlebar window creation failed, falling back to default frame', err);
    return new BrowserWindow(baseOptions);
  }
}

function createWindow(): void {
  mainWindow = createBrowserWindow();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Renderer failed to load:', errorCode, errorDescription);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason);
  });

  const splashStartedAt = Date.now();
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    splashWindow?.close();
    splashWindow = null;
    mainWindow?.show();
  };

  const forceRevealTimer = setTimeout(reveal, SPLASH_MAX_WAIT_MS);
  mainWindow.once('ready-to-show', () => {
    clearTimeout(forceRevealTimer);
    const elapsed = Date.now() - splashStartedAt;
    const remaining = Math.max(0, SPLASH_MIN_DURATION_MS - elapsed);
    setTimeout(reveal, remaining);
  });
}

// "DSP" toolbar button — opens the ad platform's own buy/login page in its own window.
// insertCSS (rather than a script injected into the untrusted page's own JS context) only
// touches styling, never executes anything on the page, so this stays safe even though the
// page itself is third-party content this app doesn't control.
const DSP_URL = 'https://buy.kz.omniboard360.io/#/login';

const DSP_THEME_CSS = `
  html, body {
    background: #0f1115 !important;
    color: #f2f2f4 !important;
  }
  a { color: #ff2d78 !important; }
  button, [type="submit"], [type="button"], .btn, .button {
    background-color: #e5157e !important;
    border-color: #e5157e !important;
    color: #ffffff !important;
  }
  input, select, textarea {
    background-color: #1a1a1f !important;
    color: #f2f2f4 !important;
    border-color: #333338 !important;
  }
  ::selection { background: #ff2d78; color: #ffffff; }
`;

function createDspWindow(): BrowserWindow {
  const baseOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 860,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    title: 'DSP',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  try {
    return new BrowserWindow({
      ...baseOptions,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#E5157E', symbolColor: '#ffffff', height: 32 },
    });
  } catch (err) {
    console.error('Custom titlebar DSP window creation failed, falling back to default frame', err);
    return new BrowserWindow(baseOptions);
  }
}

function openDspWindow(): void {
  if (dspWindow && !dspWindow.isDestroyed()) {
    dspWindow.focus();
    return;
  }
  dspWindow = createDspWindow();
  dspWindow.loadURL(DSP_URL);
  dspWindow.webContents.on('dom-ready', () => {
    dspWindow?.webContents.insertCSS(DSP_THEME_CSS).catch((err) => {
      console.error('Failed to inject DSP theme CSS', err);
    });
  });
  dspWindow.on('closed', () => {
    dspWindow = null;
  });
}

// After a successful login, always unlock the main window — an unpaid subscription no longer
// blocks entry here. Instead the main window itself shows a lit-up "Оплатить тариф" button and
// gates each node's Generate action behind a payment modal (see subscription:get-status below
// and src/store/subscriptionContext.ts), so a user can look around, build a project, and only
// hits the paywall when they actually try to spend money on a generation.
function proceedPastLogin(event: Electron.IpcMainEvent): void {
  if (event.sender.isDestroyed()) return;
  event.sender.send('auth:login-result', { ok: true });
  createWindow();
}

// The splash window's own renderer (electron/splashPreload.ts + splash.html) sends this once
// the user submits the login form; login succeeding is what unlocks the main window when
// auth is configured. If auth isn't configured, the app boots straight to createWindow() and
// this listener is simply never exercised.
ipcMain.on(
  'auth:login-request',
  (
    event,
    { email, password, rememberMe }: { email: string; password: string; rememberMe: boolean }
  ) => {
    supabaseLogin(email, password).then((result) => {
      if (event.sender.isDestroyed()) return;
      if (result.ok) {
        store.set('rememberMe', rememberMe);
        proceedPastLogin(event);
      } else {
        event.sender.send('auth:login-result', { ok: false, error: result.error });
      }
    });
  }
);

ipcMain.on(
  'auth:register-request',
  (event, { email, password }: { email: string; password: string }) => {
    supabaseRegister(email, password).then((result) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('auth:register-result', result);
    });
  }
);

ipcMain.on('auth:open-checkout', (_event, url: string) => {
  void shell.openExternal(url);
});

ipcMain.on('dsp:open', () => {
  openDspWindow();
});

// Lets the splash screen show a "Купить подписку" button before the user even logs in.
// Unlike the paywall panel's checkout link, there's no Supabase session yet at this point, so
// no user id can be attached — the splash script prefills checkout[email] instead (from
// whatever's typed in the login form) and lemonsqueezy-webhook falls back to looking up the
// Supabase user by that email when custom_data.user_id isn't present.
ipcMain.handle('auth:get-checkout-url', () => LEMONSQUEEZY_CHECKOUT_URL);

ipcMain.on('auth:close-app', () => {
  app.quit();
});

// Lets someone explore the app without logging in — skips both the Supabase login and any
// LemonSqueezy subscription check entirely, going straight to the normal main window.
ipcMain.on('auth:demo-mode', () => {
  createWindow();
});

// Login is required on every launch by default — any session saved from a previous run is
// discarded rather than reused to skip the form. The one exception is "Запомнить меня": if
// the last login opted in (rememberMe in the store), try the saved session's refresh token
// first and only fall back to the form if it's missing or no longer refreshable.
async function tryAutoLogin(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!splashWindow || splashWindow.isDestroyed()) return resolve();
    splashWindow.webContents.once('did-finish-load', () => resolve());
  });
  if (!splashWindow || splashWindow.isDestroyed()) return;

  if (!store.get('rememberMe')) {
    store.delete('authSession');
    splashWindow.webContents.send('auth:show-login');
    return;
  }

  const session = await getValidSession();
  if (!splashWindow || splashWindow.isDestroyed()) return;
  if (!session) {
    splashWindow.webContents.send('auth:show-login');
    return;
  }

  createWindow();
}

app.whenReady().then(() => {
  splashWindow = createSplashWindow();

  if (!isAuthConfigured()) {
    createWindow();
  } else {
    void tryAutoLogin();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('auth:get-status', async () => {
  if (!isAuthConfigured()) return { configured: false, email: null };
  const session = await getValidSession();
  return { configured: true, email: session?.email ?? null };
});

ipcMain.handle('auth:get-subscription-info', async () => {
  if (!isPaymentConfigured()) return { configured: false, status: null, currentPeriodEnd: null };
  const session = await getValidSession();
  if (!session) return { configured: true, status: null, currentPeriodEnd: null };
  try {
    const row = await fetchSubscriptionRow(session);
    return {
      configured: true,
      status: row?.status ?? null,
      currentPeriodEnd: row?.current_period_end ?? null,
    };
  } catch (err) {
    console.error('Subscription info fetch failed', err);
    return { configured: true, status: null, currentPeriodEnd: null };
  }
});

// Drives the main window's "Оплатить тариф" button and the per-node payment gate — unlike
// auth:get-subscription-info (raw status for the profile popup), this collapses straight to
// the yes/no the UI actually needs plus a ready-to-open checkout link.
ipcMain.handle('subscription:get-status', async () => {
  if (!isPaymentConfigured()) return { active: true, checkoutUrl: '' };
  const session = await getValidSession();
  if (!session) return { active: true, checkoutUrl: '' };
  const active = await isSubscriptionActive(session);
  return { active, checkoutUrl: active ? '' : buildCheckoutUrl(session.email, session.userId) };
});

// Unlike subscription:get-status's checkoutUrl (only set when there's no active subscription),
// this always returns a ready-to-open link when logged in — the pricing modal's "Оформить"
// tops up a balance that can run out regardless of subscription status.
ipcMain.handle('credit:get-checkout-url', async () => {
  if (!isPaymentConfigured()) return '';
  const session = await getValidSession();
  if (!session) return '';
  return buildCheckoutUrl(session.email, session.userId);
});

interface AdminMessage {
  id: string;
  body: string;
  createdAt: string;
}

async function fetchAdminMessages(session: AuthSession): Promise<AdminMessage[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_messages?select=id,body,created_at&target_user_id=eq.${session.userId}&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
    }
  );
  if (!res.ok) return [];
  const rows: { id: string; body: string; created_at: string }[] = await res.json();
  return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at }));
}

ipcMain.handle('admin:send-message', async (_event, email: string, message: string) => {
  const session = await getValidSession();
  if (!session) return { ok: false, error: 'Не выполнен вход.' };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ email, message }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || 'Не удалось отправить сообщение.' };
    return { ok: true };
  } catch (err) {
    console.error('Admin message send failed', err);
    return { ok: false, error: 'Не удалось связаться с сервером.' };
  }
});

// Messages aren't deleted after being read (so the admin keeps a record on their side) — this
// tracks which ones this install has already shown, in seenAdminMessageIds, so the same
// message doesn't pop up again on every poll.
ipcMain.handle('admin:get-pending-messages', async (): Promise<AdminMessage[]> => {
  const session = await getValidSession();
  if (!session) return [];
  try {
    const all = await fetchAdminMessages(session);
    const seen = new Set(store.get('seenAdminMessageIds') ?? []);
    const unseen = all.filter((m) => !seen.has(m.id));
    if (unseen.length > 0) {
      store.set('seenAdminMessageIds', [...seen, ...unseen.map((m) => m.id)].slice(-500));
    }
    return unseen;
  } catch (err) {
    console.error('Admin messages fetch failed', err);
    return [];
  }
});

// Best-effort "I'm still here" ping — sent by every signed-in client on a timer (see
// AdminMessageToast.tsx, which piggybacks this onto its existing pending-messages poll) so the
// admin's online-users list (admin:get-online-users below) has something fresh to read. A
// user who stops heartbeating just ages out of that list's time window; no session/logout
// hook needed to mark someone offline. Goes through the presence-heartbeat Edge Function
// (service role) rather than a direct REST upsert — RLS-gated upserts from the client turned
// out unreliable in practice, and this way user_id/email come from the caller's own verified
// JWT server-side rather than from anything the client claims.
ipcMain.handle('presence:heartbeat', async () => {
  const session = await getValidSession();
  if (!session) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/presence-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: '{}',
    });
    if (!res.ok) {
      console.error('Presence heartbeat rejected', res.status, await res.text());
    }
  } catch (err) {
    console.error('Presence heartbeat failed', err);
  }
});

interface OnlineUser {
  email: string;
  lastSeen: string;
}

ipcMain.handle('admin:get-online-users', async (): Promise<OnlineUser[]> => {
  const session = await getValidSession();
  if (!session) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-list-online`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: '{}',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Online users fetch failed', err);
    return [];
  }
});

ipcMain.handle('auth:logout', () => {
  store.delete('authSession');
  store.delete('rememberMe');
  app.relaunch();
  app.exit();
  return true;
});

ipcMain.handle('settings:get-api-key', () => store.get('apiKey') ?? '');

ipcMain.handle('settings:set-api-key', (_event, key: string) => {
  store.set('apiKey', key);
  return true;
});

ipcMain.handle(
  'generate:image',
  async (
    _event,
    params: {
      model: string;
      prompt: string;
      aspectRatio: string;
      resolution?: string;
      image?: string;
      images?: string[];
      width?: number;
      height?: number;
      projectId?: string;
      category?: 'image' | 'adapt';
    }
  ) => {
    const replicate = getReplicate();
    const { model, prompt, aspectRatio, resolution, image, width, height, images, projectId, category } =
      params;
    const input = buildImageInput(model, prompt, aspectRatio, image, width, height, images, resolution);
    const output = await runReplicateWithRetry(replicate, model as `${string}/${string}`, input);
    const outputs = normalizeOutput(output);
    const costUsd = estimateImageCost(model, resolution, outputs.length);
    bumpUsage(costUsd);
    logGeneration({ timestamp: Date.now(), model, category: category ?? 'image', costUsd });
    if (projectId) void saveToArchive(projectId, category ?? 'image', outputs);
    return outputs;
  }
);

ipcMain.handle(
  'generate:vector',
  async (_event, params: { prompt: string; aspectRatio: string; projectId?: string }) => {
    const replicate = getReplicate();
    const { prompt, aspectRatio, projectId } = params;
    const input = buildVectorInput(prompt, aspectRatio);
    const output = await runReplicateWithRetry(replicate, 'recraft-ai/recraft-v4-svg', input);
    const outputs = normalizeOutput(output);
    const costUsd = estimateImageCost('recraft-ai/recraft-v4-svg', undefined, outputs.length);
    bumpUsage(costUsd);
    logGeneration({
      timestamp: Date.now(),
      model: 'recraft-ai/recraft-v4-svg',
      category: 'vector',
      costUsd,
    });
    if (projectId) void saveToArchive(projectId, 'vector', outputs);
    return outputs;
  }
);

ipcMain.handle(
  'generate:video',
  async (
    _event,
    params: {
      model: string;
      prompt: string;
      image?: string;
      aspectRatio: string;
      duration: number;
      resolution: string;
      projectId?: string;
    }
  ) => {
    const replicate = getReplicate();
    const { model, prompt, image, aspectRatio, duration, resolution, projectId } = params;
    const input = buildVideoInput(model, prompt, image, aspectRatio, duration, resolution);
    const output = await runReplicateWithRetry(replicate, model as `${string}/${string}`, input);
    const costUsd = estimateVideoCost(model, resolution, duration);
    bumpUsage(costUsd);
    logGeneration({ timestamp: Date.now(), model, category: 'video', costUsd });
    const outputs = normalizeOutput(output);
    if (projectId) void saveToArchive(projectId, 'video', outputs);
    return outputs;
  }
);

// "Генерация видео PRO" — Seedance 2.5 only, multimodal (@Image/@Video/@Audio references
// tagged directly in the prompt text by the user). Field names for the reference arrays
// aren't published in an exact machine-readable schema by Replicate at the time of writing;
// "images"/"videos"/"audios" are the best-supported reading of Replicate's own model
// description page. If Replicate rejects these as unexpected properties, its error message
// names the actual expected key, which is the fastest way to correct this.
ipcMain.handle(
  'generate:video-pro',
  async (
    _event,
    params: {
      prompt: string;
      aspectRatio: string;
      duration: number;
      resolution: string;
      images?: string[];
      videos?: string[];
      audios?: string[];
      projectId?: string;
    }
  ) => {
    const replicate = getReplicate();
    const { prompt, aspectRatio, duration, resolution, images, videos, audios, projectId } =
      params;
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, [
        '16:9',
        '4:3',
        '1:1',
        '3:4',
        '9:16',
        '21:9',
      ]),
      duration: Math.round(duration),
      resolution,
    };
    if (images?.length) input.images = images;
    if (videos?.length) input.videos = videos;
    if (audios?.length) input.audios = audios;
    const output = await runReplicateWithRetry(replicate, 'bytedance/seedance-2.5', input);
    const costUsd = estimateVideoCost('bytedance/seedance-2.5', resolution, duration);
    bumpUsage(costUsd);
    logGeneration({
      timestamp: Date.now(),
      model: 'bytedance/seedance-2.5',
      category: 'video',
      costUsd,
    });
    const outputs = normalizeOutput(output);
    if (projectId) void saveToArchive(projectId, 'video', outputs);
    return outputs;
  }
);

ipcMain.handle('budget:get-usage', () => getUsage());

ipcMain.handle('history:get', () => store.get('generationLog') ?? []);

ipcMain.handle('budget:set-limit', (_event, limit: number) => {
  store.set('generationLimit', Math.max(0.01, limit));
  return true;
});

ipcMain.handle('archive:list', (_event, projectId: string) => listArchive(projectId));

ipcMain.handle('archive:open-folder', (_event, projectId: string) => {
  const folder = projectArchiveFolder(projectId);
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
  return true;
});

ipcMain.handle(
  'generate:chat',
  async (
    _event,
    messages: { role: 'user' | 'assistant'; content: string }[],
    images?: string[],
    mode?: 'assistant' | 'text'
  ) => {
    const replicate = getReplicate();
    const transcript =
      messages
        .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`)
        .join('\n\n') + '\n\nАссистент:';
    const input: Record<string, unknown> = {
      prompt: transcript,
      system_prompt: mode === 'text' ? TEXT_CHAT_SYSTEM_PROMPT : NODE_ASSISTANT_SYSTEM_PROMPT,
    };
    // Field name for vision input on this model isn't published in an exact
    // machine-readable schema by Replicate; "image_input" matches the pattern used by the
    // other multi-image Replicate models already wired in this app (Nano Banana Pro/2). If
    // Replicate rejects this as an unexpected property, its error message names the real key.
    if (images?.length) input.image_input = images;
    const output = await replicate.run('openai/gpt-5.6-terra', { input });
    return normalizeChatOutput(output);
  }
);

async function urlToBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (url.startsWith('data:')) {
    // Same fix as downloadToBuffer above — the media-type segment can carry extra
    // `;charset=...`-style parameters before `;base64` (the CSV export in ProfileModal
    // builds exactly this: `data:text/csv;charset=utf-8;base64,...`).
    const match = /^data:([^,]*);base64,([\s\S]*)$/.exec(url);
    if (!match) throw new Error('Malformed data URL');
    return { buffer: Buffer.from(match[2], 'base64'), contentType: match[1].split(';')[0] };
  }
  const response = await fetch(url);
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
}

ipcMain.handle(
  'file:save',
  async (_event, payload: { url: string; suggestedName: string }) => {
    if (!mainWindow) return null;
    const { url, suggestedName } = payload;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
    });
    if (canceled || !filePath) return null;
    const { buffer } = await urlToBuffer(url);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }
);

ipcMain.handle(
  'file:save-many',
  async (_event, payload: { files: { name: string; url: string }[] }) => {
    if (!mainWindow) return null;
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Выберите папку для сохранения',
    });
    if (canceled || filePaths.length === 0) return null;
    const dir = filePaths[0];
    for (const file of payload.files) {
      const { buffer } = await urlToBuffer(file.url);
      fs.writeFileSync(path.join(dir, file.name), buffer);
    }
    return dir;
  }
);

ipcMain.handle('image:fetch-as-data-url', async (_event, url: string) => {
  // Fetching in the main process avoids browser CORS restrictions that would
  // otherwise taint the <canvas> used for client-side image resizing.
  const { buffer, contentType } = await urlToBuffer(url);
  return `data:${contentType};base64,${buffer.toString('base64')}`;
});

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

ipcMain.handle('image:pick-file', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const contentType = IMAGE_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  return `data:${contentType};base64,${buffer.toString('base64')}`;
});

const MEDIA_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
};

const MEDIA_EXTENSIONS_BY_KIND: Record<'video' | 'audio', string[]> = {
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg'],
};

ipcMain.handle('media:pick-file', async (_event, kind: 'video' | 'audio') => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      {
        name: kind === 'video' ? 'Видео' : 'Аудио',
        extensions: MEDIA_EXTENSIONS_BY_KIND[kind] ?? [],
      },
    ],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const contentType =
    MEDIA_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  return `data:${contentType};base64,${buffer.toString('base64')}`;
});

interface ProjectFile {
  name: string;
  nodes: unknown[];
  edges: unknown[];
}

interface WorkspaceFile {
  projects: { id: string; name: string; nodes: unknown[]; edges: unknown[] }[];
}

ipcMain.handle('project:save', async (_event, project: ProjectFile) => {
  if (!mainWindow) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${project.name || 'project'}.aystudio.json`,
    filters: [{ name: 'Node AI Studio проект', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
  return filePath;
});

ipcMain.handle('project:open', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Node AI Studio проект', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const raw = fs.readFileSync(filePaths[0], 'utf-8');
  return JSON.parse(raw) as ProjectFile;
});

ipcMain.handle('workspace:save', async (_event, workspace: WorkspaceFile) => {
  if (!mainWindow) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'workspace.aystudio-workspace.json',
    filters: [{ name: 'Node AI Studio рабочая область', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(workspace, null, 2), 'utf-8');
  return filePath;
});

ipcMain.handle('workspace:open', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Node AI Studio рабочая область', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const raw = fs.readFileSync(filePaths[0], 'utf-8');
  return JSON.parse(raw) as WorkspaceFile;
});

interface AdaptPresetFormat {
  label: string;
  width: number;
  height: number;
}

ipcMain.handle('presets:get-adapt', (_event, key: string): AdaptPresetFormat[] => {
  // Sanitize: only bare alphanumeric preset keys map to files under electron/presets.
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return [];
  const filePath = path.join(__dirname, 'presets', `${key}.txt`);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const formats: AdaptPresetFormat[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(',');
    if (parts.length < 3) continue;
    const width = Number(parts[parts.length - 2]);
    const height = Number(parts[parts.length - 1]);
    const label = parts.slice(0, parts.length - 2).join(',').trim();
    if (!label || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    formats.push({ label, width, height });
  }
  return formats;
});
