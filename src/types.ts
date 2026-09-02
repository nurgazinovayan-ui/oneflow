export interface ImageGenParams {
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

// "Музыка и аудио" — two very different generation shapes (a song from a style prompt +
// lyrics vs. a spoken phrase in a chosen voice/language) sharing one params bag since both go
// through a single generateAudio API call, distinguished by `mode`.
export type AudioMode = 'music' | 'speech';

export interface AudioGenParams {
  mode: AudioMode;
  prompt?: string;
  lyrics?: string;
  format?: string;
  text?: string;
  voice?: string;
  language?: string;
}

// One file under the caller's Yandex Disk /ONEFLOW folder — see
// supabase/functions/yandex-list-assets. `url` is Yandex's own temporary direct-download link
// (the resource's `file` field) — kept for reference/debugging, but NOT safe to use directly as
// an <img>/<video> src: loading it cross-origin from the browser doesn't reliably render (see
// NodeApi.loadYandexAsset, which proxies the bytes through yandex-asset-download instead).
export interface YandexAsset {
  name: string;
  path: string;
  url: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  size: number;
  created: string;
}

// Real Gemini TTS voice names (Google's Gemini API "Speech generation" voice list, all 30
// prebuilt voices) — used as-is since google/gemini-3.1-flash-tts is presumed to accept the
// same voice catalog.
export const TTS_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;

// Genre tags for the "Музыка" mode's genre picker — folded into the style prompt sent to
// minimax/music-2.5 (see MusicAudioPanel.handleGenerate), same approach as how the speech
// mode's tone prompt gets folded into its text field server-side. Plain genre words rather than
// localized strings since they're used internationally as-is (including in Russian).
export const MUSIC_GENRES = [
  'Pop',
  'Rock',
  'Hip-Hop',
  'Electronic',
  'Jazz',
  'Classical',
  'Lo-fi',
  'Ambient',
  'Folk',
  'R&B',
  'Metal',
  'Reggae',
  'Country',
  'Blues',
  'Funk',
] as const;

export const TTS_LANGUAGES = [
  { code: 'ru-RU', label: 'Русский' },
  { code: 'en-US', label: 'English' },
  { code: 'kk-KZ', label: 'Қазақша' },
  { code: 'es-ES', label: 'Español' },
  { code: 'de-DE', label: 'Deutsch' },
] as const;

export const AUDIO_FORMATS = ['mp3', 'wav'] as const;

// Max number of ordered reference-image connectors on "Генерация фото".
export const IMAGE_REFERENCE_SLOTS = 7;

// "Генерация фото" runs one Replicate call per variant (rather than trusting a per-model
// "generate N at once" parameter) — some models' num_images-style fields are unreliable or
// silently ignored, so looping guarantees the requested count regardless of model.
export const IMAGE_VARIANT_COUNTS = [1, 2, 3, 4] as const;

export interface VectorGenParams {
  prompt: string;
  aspectRatio: string;
  projectId?: string;
}

// "Вектор" node — SVG-only output, single fixed model.
export const VECTOR_MODEL = 'recraft-ai/recraft-v4-svg';

export interface VideoGenParams {
  model: string;
  prompt: string;
  image?: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  projectId?: string;
}

// "Генерация видео PRO" — Seedance 2.5 only, with multimodal @Image/@Video/@Audio references.
// Limits per ByteDance's documented capacity for a single generation.
export const VIDEO_PRO_MODEL = 'bytedance/seedance-2.5';
export const VIDEO_PRO_REFERENCE_LIMITS = { images: 30, videos: 10, audios: 10 } as const;

export interface VideoGenProParams {
  prompt: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
  projectId?: string;
}

export interface ProjectFile {
  name: string;
  nodes: unknown[];
  edges: unknown[];
}

export interface WorkspaceFile {
  projects: { id: string; name: string; nodes: unknown[]; edges: unknown[] }[];
}

export interface AdaptPresetFormat {
  label: string;
  width: number;
  height: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 'assistant' = the canvas-side ИИ ассистент, which may build node chains on request.
// 'text' = the standalone Работа с текстом chat — general-purpose, never builds nodes.
export type ChatMode = 'assistant' | 'text';

export interface BudgetUsage {
  costUsd: number;
  limit: number;
  month: string;
}

export interface SubscriptionInfo {
  configured: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
}

export interface SubscriptionStatus {
  active: boolean;
  checkoutUrl: string;
}

export interface GenerationLogEntry {
  timestamp: number;
  model: string;
  category: 'image' | 'video' | 'adapt' | 'vector' | 'audio';
  costUsd: number;
}

// Replicate has no API that returns a prediction's real dollar cost — these are the
// per-model rates Replicate publishes on each model's own pricing page, captured by hand.
// Nano Banana Pro/2 and GPT Image 2 bill per output image at a rate that depends on
// resolution/quality; the video models bill per second of output at a rate that depends on
// resolution. If Replicate changes a model's price, update the matching entry here (and the
// duplicate copy in electron/main.ts, kept in sync by hand across compile roots).
export const IMAGE_PRICE_USD: Record<string, Record<string, number> | number> = {
  'google/nano-banana-pro': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  'google/nano-banana-2': { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  'openai/gpt-image-2': { auto: 0.08, low: 0.006, medium: 0.053, high: 0.211 },
  'recraft-ai/recraft-v4-svg': 0.08,
};

export const VIDEO_PRICE_PER_SECOND_USD: Record<string, Record<string, number>> = {
  'bytedance/seedance-2.0': { '480p': 0.15, '720p': 0.3 },
  'bytedance/seedance-2.5': { '480p': 0.11, '720p': 0.24, '1080p': 0.4 },
  'kwaivgi/kling-v3-video': { '720p': 0.126, '1080p': 0.168 },
};

export function estimateImageCost(
  model: string,
  resolution: string | undefined,
  outputCount: number
): number {
  const entry = IMAGE_PRICE_USD[model];
  if (entry === undefined) return 0;
  const perImage =
    typeof entry === 'number' ? entry : (resolution && entry[resolution]) || Object.values(entry)[0];
  return perImage * Math.max(1, outputCount);
}

export function estimateVideoCost(model: string, resolution: string, duration: number): number {
  const rates = VIDEO_PRICE_PER_SECOND_USD[model];
  if (!rates) return 0;
  const perSecond = rates[resolution] ?? Object.values(rates)[0];
  return perSecond * Math.max(1, duration);
}

// Neither minimax/music-2.5 nor google/gemini-3.1-flash-tts nor openai/gpt-5.6-terra (used by
// evaluate-creative) publish a fixed per-call USD rate the way the image/video models above do —
// these are rough flat estimates, not scraped from a pricing page. Adjust if Replicate's actual
// billed amount for these calls turns out to differ meaningfully.
export const AUDIO_PRICE_USD: Record<'music' | 'speech', number> = {
  music: 0.2,
  speech: 0.02,
};

export function estimateAudioCost(mode: 'music' | 'speech' | undefined): number {
  return AUDIO_PRICE_USD[mode === 'speech' ? 'speech' : 'music'];
}

export const EVALUATE_CREATIVE_PRICE_PER_IMAGE_USD = 0.03;

export function estimateEvaluateCreativeCost(imageCount: number): number {
  return EVALUATE_CREATIVE_PRICE_PER_IMAGE_USD * Math.max(1, imageCount);
}

export interface ArchiveEntry {
  fileName: string;
  category: 'image' | 'video' | 'adapt' | 'vector';
  savedAt: number;
  url: string;
}

export interface AuthStatus {
  configured: boolean;
  email: string | null;
}

// The only account allowed to send targeted admin messages (see AdminSendMessageModal /
// admin-send-message Edge Function, which enforces this same check server-side against the
// caller's own JWT — this copy only controls whether the UI shows the button).
export const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';

export interface AdminMessage {
  id: string;
  body: string;
  createdAt: string;
}

export interface OnlineUser {
  email: string;
  lastSeen: string;
}

// Who to reach with an admin broadcast — either every registered account (minus the admin
// themself) or a specific list of email addresses picked from the online list / typed by hand.
export type AdminMessageTarget = { mode: 'all' } | { mode: 'selected'; emails: string[] };

// One completed generation, logged server-side by each generate-*/evaluate-creative Edge
// Function (see supabase/functions/admin-list-generations) — admin-only, and only ever
// returned for accounts whose email ends in @mechta.kz (enforced server-side, not just here).
export interface AdminGenerationRecord {
  email: string;
  model: string;
  category: string;
  costUsd: number;
  createdAt: string;
}

// A heuristic design-quality read on an ad creative — NOT a statistical CTR prediction (no
// model here has real impression/click data to calibrate against). Comparing 2-3 variants
// against each other is the more reliable use of this: relative judgment beats an absolute
// score. See supabase/functions/evaluate-creative for how the score/verdict are produced.
export interface CreativeVariantEvaluation {
  score: number;
  strengths: string[];
  weaknesses: string[];
}

export interface CreativeEvaluationResult {
  variants: CreativeVariantEvaluation[];
  verdict?: string;
  winnerIndex?: number;
}

export interface NodeApi {
  getApiKey: () => Promise<string>;
  setApiKey: (key: string) => Promise<boolean>;
  generateImage: (params: ImageGenParams) => Promise<string[]>;
  generateVideo: (params: VideoGenParams) => Promise<string[]>;
  generateVideoPro: (params: VideoGenProParams) => Promise<string[]>;
  generateVector: (params: VectorGenParams) => Promise<string[]>;
  saveFile: (url: string, suggestedName: string) => Promise<string | null>;
  saveManyFiles: (files: { name: string; url: string }[]) => Promise<string | null>;
  fetchImageAsDataUrl: (url: string) => Promise<string>;
  pickImageFile: () => Promise<string | null>;
  pickMediaFile: (kind: 'video' | 'audio') => Promise<string | null>;
  saveProjectFile: (project: ProjectFile) => Promise<string | null>;
  openProjectFile: () => Promise<ProjectFile | null>;
  saveWorkspaceFile: (workspace: WorkspaceFile) => Promise<string | null>;
  openWorkspaceFile: () => Promise<WorkspaceFile | null>;
  getAdaptPreset: (key: string) => Promise<AdaptPresetFormat[]>;
  generateChat: (messages: ChatMessage[], images?: string[], mode?: ChatMode) => Promise<string>;
  getUsage: () => Promise<BudgetUsage>;
  setGenerationLimit: (limit: number) => Promise<boolean>;
  listArchive: (projectId: string) => Promise<ArchiveEntry[]>;
  openArchiveFolder: (projectId: string) => Promise<boolean>;
  getAuthStatus: () => Promise<AuthStatus>;
  logout: () => Promise<boolean>;
  openDsp: () => void;
  getSubscriptionInfo: () => Promise<SubscriptionInfo>;
  getGenerationHistory: () => Promise<GenerationLogEntry[]>;
  sendAdminMessage: (
    target: AdminMessageTarget,
    message: string
  ) => Promise<{ ok: boolean; error?: string; count?: number }>;
  getPendingMessages: () => Promise<AdminMessage[]>;
  sendHeartbeat: () => Promise<void>;
  getOnlineUsers: () => Promise<OnlineUser[]>;
  // Admin-only (nurgazinov.ayan@gmail.com) — see AdminGenerationRecord's comment.
  getMechtaGenerations: () => Promise<AdminGenerationRecord[]>;
  getSubscriptionStatus: () => Promise<SubscriptionStatus>;
  openCheckout: (url: string) => void;
  // Real dollars available to spend on generations funded by the shared owner Replicate
  // account — credited at 85% of what a tariff payment charges (see lemonsqueezy-webhook),
  // never $0 unless the account has never paid. Desktop/mock builds bring their own Replicate
  // key and aren't metered this way, so they report Infinity (no restriction).
  getCreditBalance: () => Promise<number>;
  // Always returns a ready-to-open checkout link when logged in (empty string if not
  // configured/logged in) — unlike getSubscriptionStatus().checkoutUrl, this isn't gated on
  // "no active subscription", since paying here tops up a balance that can run out at any time
  // regardless of subscription status.
  getCheckoutUrl: () => Promise<string>;
  evaluateCreative: (images: string[], platform?: string) => Promise<CreativeEvaluationResult>;
  generateAudio: (params: AudioGenParams) => Promise<string>;
  connectYandexDisk: (code: string) => Promise<boolean>;
  isYandexDiskConnected: () => boolean;
  disconnectYandexDisk: () => void;
  listYandexAssets: () => Promise<YandexAsset[]>;
  // Fetches one asset's actual bytes through yandex-asset-download (server-side, using the
  // stored OAuth token) and returns a blob: URL — usable directly as an <img>/<video> src, or
  // passed to saveFile for downloading. Caller is responsible for URL.revokeObjectURL(...) once
  // done with it (see AssetsPanel's cleanup effect).
  loadYandexAsset: (path: string) => Promise<string>;
}

declare global {
  interface Window {
    api: NodeApi;
  }
}

// "DSP" toolbar button — opens the ad platform's own buy/login page. On desktop this opens in
// a themed Electron window (see electron/main.ts, which injects CSS to match the app's
// palette); the browser can't do that for a cross-origin popup, so web/mock just open a new
// tab with the page's own styling.
export const DSP_URL = 'https://buy.kz.omniboard360.io/#/login';

// Labels here are the untranslated fallback; the few that actually have a translatable word
// in them (Nano Banana 2's "editing", GPT Image 2's quality tiers, the PSD save format, the
// РСЯ/YAN preset) are swapped for a t.nodes.modelMeta.* string at render time.
export const IMAGE_MODELS = [
  { label: 'Nano Banana Pro (Google, Gemini 3)', value: 'google/nano-banana-pro' },
  { label: 'Nano Banana 2 (Google, editing)', value: 'google/nano-banana-2' },
  { label: 'GPT Image 2 (OpenAI)', value: 'openai/gpt-image-2' },
] as const;

export const VIDEO_MODELS = [
  { label: 'Seedance 2.0 (ByteDance)', value: 'bytedance/seedance-2.0' },
  { label: 'Seedance 2.5 (ByteDance)', value: 'bytedance/seedance-2.5' },
  { label: 'Kling 3.0 (Kuaishou)', value: 'kwaivgi/kling-v3-video' },
] as const;

// Model-select dropdowns show just the name — the "(vendor, ...)" suffix on the labels above
// stays in the data (still useful context elsewhere) but is trimmed at render time.
export function modelShortName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export const ASPECT_RATIOS = ['9:16', '1:1', '16:9', '5:4', '21:9', '4:3', '2:3'] as const;

export interface ImageModelMeta {
  resolutions: { label: string; value: string }[];
}

// Nano Banana Pro/2 take a "resolution" tier (1K/2K/4K); GPT Image 2 has no raw resolution
// knob and instead controls output detail via "quality" — modeled here as the same UI
// concept so the selector reads consistently across models. "Авто" preserves the previous
// (pre-selector) behavior of leaving quality unset for GPT Image 2.
export const IMAGE_MODEL_META: Record<string, ImageModelMeta> = {
  'google/nano-banana-pro': {
    resolutions: [
      { label: '1K', value: '1K' },
      { label: '2K', value: '2K' },
      { label: '4K', value: '4K' },
    ],
  },
  'google/nano-banana-2': {
    resolutions: [
      { label: '1K', value: '1K' },
      { label: '2K', value: '2K' },
      { label: '4K', value: '4K' },
    ],
  },
  'openai/gpt-image-2': {
    resolutions: [
      { label: 'Auto', value: 'auto' },
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
  },
};

export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 768, height: 1344 },
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '5:4': { width: 1280, height: 1024 },
  '21:9': { width: 1344, height: 576 },
  '4:3': { width: 1024, height: 768 },
  '2:3': { width: 896, height: 1344 },
};

export const IMAGE_SAVE_FORMATS = [
  { label: 'PNG', value: 'png' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'WEBP', value: 'webp' },
] as const;

export const ADAPT_SAVE_FORMATS = [
  ...IMAGE_SAVE_FORMATS,
  { label: 'PSD (Photoshop, 2 layers)', value: 'psd' },
] as const;

export interface VideoModelMeta {
  maxDuration: number;
  minDuration?: number;
  resolutions: string[];
}

// Model used exclusively by the "Адаптация" node for AI-driven format adaptation.
// GPT Image 2 only outputs 1:1 / 3:2 / 2:3 (no arbitrary width/height) — buildAdaptPrompt
// tells it the exact target dimensions/shape so it recomposes hierarchy and elements with
// that in mind, then a final local pass (coverResizeExact) crops to the exact requested
// pixel size. For very extreme ratios (e.g. thin banners) some crop is unavoidable since the
// model cannot natively draw that shape — black-forest-labs/flux-kontext-pro is the
// alternative that accepts width/height directly if that becomes a problem again.
export const ADAPT_MODEL = 'openai/gpt-image-2';

// Ad-platform preset keys map to electron/presets/<key>.txt (kept in sync by hand).
export const ADAPT_PRESETS = [
  { key: 'BYYD', label: 'BYYD' },
  { key: 'Discovery', label: 'Discovery' },
  { key: 'GDN', label: 'GDN' },
  { key: 'Kaspi', label: 'Kaspi' },
  { key: 'RSYA', label: 'YAN' },
] as const;

// Kling 3.0 uses a "standard"/"pro" mode instead of a raw resolution — 720p/1080p map to
// mode in buildVideoInput (electron/main.ts). Seedance 2.5 additionally supports native 4K,
// omitted here since its exact API enum casing isn't confirmed from public docs.
export const VIDEO_MODEL_META: Record<string, VideoModelMeta> = {
  'bytedance/seedance-2.0': { maxDuration: 15, minDuration: 1, resolutions: ['480p', '720p'] },
  'bytedance/seedance-2.5': {
    maxDuration: 30,
    minDuration: 4,
    resolutions: ['480p', '720p', '1080p'],
  },
  'kwaivgi/kling-v3-video': { maxDuration: 15, minDuration: 3, resolutions: ['720p', '1080p'] },
};
