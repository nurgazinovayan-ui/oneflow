import type {
  NodeApi,
  ProjectFile,
  WorkspaceFile,
  AdaptPresetFormat,
  AuthStatus,
  GenerationLogEntry,
  AdminMessage,
  OnlineUser,
  SubscriptionStatus,
  CreativeEvaluationResult,
  AudioGenParams,
} from './types';
import { estimateImageCost, estimateVideoCost, DSP_URL } from './types';
import { getWebSession, setWebSession, type WebSession } from './webAuthSession';
import { useLanguageStore, ru, en } from './i18n';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const LEMONSQUEEZY_CHECKOUT_URL = (import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL as string) || '';

function buildCheckoutUrl(email: string, userId: string): string {
  const url = new URL(LEMONSQUEEZY_CHECKOUT_URL);
  url.searchParams.set('checkout[email]', email);
  url.searchParams.set('checkout[custom][user_id]', userId);
  return url.toString();
}

function t() {
  return useLanguageStore.getState().language === 'en' ? en : ru;
}

// Supabase access tokens expire after ~1 hour (expires_in in the login/signup response —
// see WebSession.expiresAt in webAuthSession.ts). The session used to just hold onto that
// token for the tab's whole lifetime with no refresh, so anyone who kept a tab open past an
// hour had every Edge Function call start failing Verify-JWT with no obvious error (and, as a
// side effect, the generation-history log never got a new entry either, since logWebGeneration
// only runs after a call succeeds) — this refreshes proactively before the token goes stale.
const TOKEN_REFRESH_BUFFER_MS = 60_000;

async function refreshSession(session: WebSession): Promise<WebSession | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const next: WebSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user?.id ?? session.userId,
      email: session.email,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    setWebSession(next);
    return next;
  } catch {
    return null;
  }
}

async function getValidSession(): Promise<WebSession | null> {
  const session = getWebSession();
  if (!session) return null;
  if (Date.now() < session.expiresAt - TOKEN_REFRESH_BUFFER_MS) return session;
  const refreshed = await refreshSession(session);
  if (!refreshed) {
    // Refresh token itself is dead (e.g. revoked, or stale after many days) — nothing left to
    // do but send the user back to the login screen.
    setWebSession(null);
    window.location.reload();
  }
  return refreshed;
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const session = await getValidSession();
  if (!session) throw new Error(t().errors.notLoggedIn);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || t().errors.generationError);
  return data as T;
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function downloadDataUrl(dataUrl: string, suggestedName: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function pickFile(accept: string): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

async function pickJsonFile<T>(): Promise<T | null> {
  return await new Promise<T | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result as string) as T);
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

function parseAdaptPresetText(raw: string): AdaptPresetFormat[] {
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
}

// Per-browser, not per-account — the web build has no server-side usage table (kept simple
// by design; see the "simplified web version" scope decision). Cost is estimated locally
// from Replicate's published per-model rates (see IMAGE_PRICE_USD/VIDEO_PRICE_PER_SECOND_USD
// in types.ts) since Replicate's API doesn't return a prediction's real dollar cost.
async function bumpWebUsage(costUsd: number): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const storedMonth = localStorage.getItem('web-usage-month');
  const total =
    (storedMonth === month ? Number(localStorage.getItem('web-usage-cost') ?? '0') : 0) + costUsd;
  localStorage.setItem('web-usage-month', month);
  localStorage.setItem('web-usage-cost', String(total));
}

// Per-generation history behind the profile popup's "count by model, exportable by date"
// view — per-browser only, same simplified-web-version scope as bumpWebUsage above.
const WEB_GENERATION_LOG_MAX_ENTRIES = 2000;

function logWebGeneration(entry: GenerationLogEntry): void {
  try {
    const log: GenerationLogEntry[] = JSON.parse(localStorage.getItem('web-generation-log') ?? '[]');
    log.push(entry);
    if (log.length > WEB_GENERATION_LOG_MAX_ENTRIES) {
      log.splice(0, log.length - WEB_GENERATION_LOG_MAX_ENTRIES);
    }
    localStorage.setItem('web-generation-log', JSON.stringify(log));
  } catch {
    // Corrupt/oversized localStorage entry — drop silently rather than block generation.
  }
}

async function fetchSubscriptionRow(session: {
  userId: string;
  accessToken: string;
}): Promise<{ status: string; current_period_end: string | null } | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${session.userId}&select=status,current_period_end`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` },
    }
  );
  if (!res.ok) return null;
  const rows: { status: string; current_period_end: string | null }[] = await res.json();
  return rows[0] ?? null;
}

export async function checkSubscriptionActive(session: {
  userId: string;
  accessToken: string;
}): Promise<boolean> {
  try {
    const row = await fetchSubscriptionRow(session);
    if (!row) return false;
    // LemonSqueezy subscription statuses: on_trial, active, paused, past_due, unpaid,
    // cancelled, expired.
    const isActiveStatus = row.status === 'active' || row.status === 'on_trial';
    const notExpired =
      !row.current_period_end || new Date(row.current_period_end).getTime() > Date.now();
    return isActiveStatus && notExpired;
  } catch {
    return false;
  }
}

const SEEN_ADMIN_MESSAGES_KEY = 'oneflow-seen-admin-messages';

function getSeenAdminMessageIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_ADMIN_MESSAGES_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function markAdminMessagesSeen(ids: string[]): void {
  if (ids.length === 0) return;
  const next = [...getSeenAdminMessageIds(), ...ids].slice(-500);
  localStorage.setItem(SEEN_ADMIN_MESSAGES_KEY, JSON.stringify(next));
}

async function fetchAdminMessages(session: {
  userId: string;
  accessToken: string;
}): Promise<AdminMessage[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_messages?select=id,body,created_at&target_user_id=eq.${session.userId}&order=created_at.desc`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` } }
  );
  if (!res.ok) return [];
  const rows: { id: string; body: string; created_at: string }[] = await res.json();
  return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at }));
}

// Best-effort "I'm still here" ping — see the matching electron/main.ts handler's comment.
// Goes through the presence-heartbeat Edge Function (service role) rather than a direct REST
// upsert — RLS-gated upserts from the client turned out unreliable in practice.
async function sendPresenceHeartbeat(session: { accessToken: string }): Promise<void> {
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
}

// Permanent storage for web generations (Replicate's own output URLs aren't durable — they
// stop resolving after a while) — mirrors every generated file to the user's own Yandex Disk
// once they've connected it (see connectYandexDisk / supabase/functions/yandex-disk-upload).
// Fire-and-forget: a failed backup shouldn't block or fail the generation itself, and the
// local "connected" flag is just a client-side hint to skip the call entirely when there's
// nothing to back up to — the Edge Function is the actual source of truth either way.
const YANDEX_CONNECTED_KEY = 'oneflow-yandex-connected';

function isYandexBackupEnabled(): boolean {
  try {
    return localStorage.getItem(YANDEX_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}

function guessExtension(url: string): string {
  const clean = url.split('?')[0];
  const match = /\.([a-zA-Z0-9]{2,5})$/.exec(clean);
  return match ? match[1] : 'bin';
}

function backupToYandexDisk(urls: string[], prefix: string): void {
  if (!isYandexBackupEnabled()) return;
  urls.forEach((url, i) => {
    const fileName = `${prefix}-${Date.now()}-${i}.${guessExtension(url)}`;
    void callFunction('yandex-disk-upload', { sourceUrl: url, fileName }).catch(() => {
      // Best-effort — a backup failure (e.g. a since-expired Yandex token) shouldn't surface
      // as a generation error.
    });
  });
}

// Used by ReloadGuard's "Save" button — unlike backupToYandexDisk (fire-and-forget for
// generated media), the caller here needs to know whether the save actually succeeded before
// deciding to go ahead with the reload, so this lets callFunction's rejection propagate instead
// of swallowing it.
export async function saveProjectToYandexDisk(project: {
  name: string;
  nodes: unknown;
  edges: unknown;
}): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  const safeName = (project.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${safeName}-${Date.now()}.aystudio.json`;
  await callFunction('yandex-project-upload', { fileName, content: json });
}

export function installWebApi(): void {
  const api: NodeApi = {
    // API key management doesn't apply on web — the Replicate key lives only as an Edge
    // Function secret and is never sent to the browser.
    getApiKey: async () => '',
    setApiKey: async () => true,

    generateImage: async (params) => {
      const outputs = await callFunction<string[]>('generate-image', params);
      const costUsd = estimateImageCost(params.model, params.resolution, outputs.length);
      void bumpWebUsage(costUsd);
      logWebGeneration({
        timestamp: Date.now(),
        model: params.model,
        category: params.category ?? 'image',
        costUsd,
      });
      backupToYandexDisk(outputs, 'image');
      return outputs;
    },
    generateVideo: async (params) => {
      const outputs = await callFunction<string[]>('generate-video', params);
      const costUsd = estimateVideoCost(params.model, params.resolution, params.duration);
      void bumpWebUsage(costUsd);
      logWebGeneration({ timestamp: Date.now(), model: params.model, category: 'video', costUsd });
      backupToYandexDisk(outputs, 'video');
      return outputs;
    },
    generateVideoPro: async (params) => {
      const outputs = await callFunction<string[]>('generate-video-pro', params);
      const costUsd = estimateVideoCost('bytedance/seedance-2.5', params.resolution, params.duration);
      void bumpWebUsage(costUsd);
      logWebGeneration({
        timestamp: Date.now(),
        model: 'bytedance/seedance-2.5',
        category: 'video',
        costUsd,
      });
      backupToYandexDisk(outputs, 'video');
      return outputs;
    },
    generateVector: async (params) => {
      const outputs = await callFunction<string[]>('generate-vector', params);
      const costUsd = estimateImageCost('recraft-ai/recraft-v4-svg', undefined, outputs.length);
      void bumpWebUsage(costUsd);
      logWebGeneration({
        timestamp: Date.now(),
        model: 'recraft-ai/recraft-v4-svg',
        category: 'vector',
        costUsd,
      });
      backupToYandexDisk(outputs, 'vector');
      return outputs;
    },
    generateChat: async (messages, images, mode) =>
      callFunction<string>('generate-chat', { messages, images, mode }),

    saveFile: async (url, suggestedName) => {
      const dataUrl = await urlToDataUrl(url);
      downloadDataUrl(dataUrl, suggestedName);
      return suggestedName;
    },
    saveManyFiles: async (files) => {
      for (const f of files) {
        const dataUrl = await urlToDataUrl(f.url);
        downloadDataUrl(dataUrl, f.name);
      }
      return files.length > 0 ? files[0].name : null;
    },
    fetchImageAsDataUrl: async (url) => urlToDataUrl(url),
    pickImageFile: async () => pickFile('image/*'),
    pickMediaFile: async (kind) => pickFile(kind === 'video' ? 'video/*' : 'audio/*'),

    saveProjectFile: async (project) => {
      const json = JSON.stringify(project, null, 2);
      const dataUrl = `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
      const fileName = `${project.name || 'project'}.aystudio.json`;
      downloadDataUrl(dataUrl, fileName);
      return fileName;
    },
    openProjectFile: async () => pickJsonFile<ProjectFile>(),
    saveWorkspaceFile: async (workspace) => {
      const json = JSON.stringify(workspace, null, 2);
      const dataUrl = `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
      const fileName = 'workspace.aystudio.json';
      downloadDataUrl(dataUrl, fileName);
      return fileName;
    },
    openWorkspaceFile: async () => pickJsonFile<WorkspaceFile>(),

    getAdaptPreset: async (key) => {
      if (!/^[A-Za-z0-9_-]+$/.test(key)) return [];
      try {
        const res = await fetch(`/presets/${key}.txt`);
        if (!res.ok) return [];
        return parseAdaptPresetText(await res.text());
      } catch {
        return [];
      }
    },

    getUsage: async () => {
      const month = new Date().toISOString().slice(0, 7);
      const storedMonth = localStorage.getItem('web-usage-month');
      const costUsd =
        storedMonth === month ? Number(localStorage.getItem('web-usage-cost') ?? '0') : 0;
      const limit = Number(localStorage.getItem('web-usage-limit') ?? '50');
      return { costUsd, limit, month };
    },
    setGenerationLimit: async (limit) => {
      localStorage.setItem('web-usage-limit', String(limit));
      return true;
    },

    // No auto-archive in the simplified web version.
    listArchive: async () => [],
    openArchiveFolder: async () => false,

    getAuthStatus: async () => {
      const session = getWebSession();
      if (!session) return { configured: true, email: null } satisfies AuthStatus;
      return { configured: true, email: session.email } satisfies AuthStatus;
    },
    logout: async () => {
      setWebSession(null);
      window.location.reload();
      return true;
    },
    openDsp: () => {
      window.open(DSP_URL, '_blank', 'noopener,noreferrer');
    },
    getSubscriptionInfo: async () => {
      const session = await getValidSession();
      if (!session) return { configured: true, status: null, currentPeriodEnd: null };
      const row = await fetchSubscriptionRow(session);
      return {
        configured: true,
        status: row?.status ?? null,
        currentPeriodEnd: row?.current_period_end ?? null,
      };
    },
    getGenerationHistory: async () => {
      try {
        return JSON.parse(localStorage.getItem('web-generation-log') ?? '[]');
      } catch {
        return [];
      }
    },
    sendAdminMessage: async (email, message) => {
      try {
        await callFunction<{ ok: true }>('admin-send-message', { email, message });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : t().errors.sendFailed };
      }
    },
    getPendingMessages: async () => {
      const session = await getValidSession();
      if (!session) return [];
      const all = await fetchAdminMessages(session);
      const seen = getSeenAdminMessageIds();
      const unseen = all.filter((m) => !seen.has(m.id));
      markAdminMessagesSeen(unseen.map((m) => m.id));
      return unseen;
    },
    sendHeartbeat: async () => {
      const session = await getValidSession();
      if (!session) return;
      await sendPresenceHeartbeat(session);
    },
    getOnlineUsers: async () => {
      try {
        return await callFunction<OnlineUser[]>('admin-list-online', {});
      } catch {
        return [];
      }
    },
    getSubscriptionStatus: async () => {
      if (!LEMONSQUEEZY_CHECKOUT_URL) return { active: true, checkoutUrl: '' } satisfies SubscriptionStatus;
      const session = await getValidSession();
      if (!session) return { active: true, checkoutUrl: '' } satisfies SubscriptionStatus;
      const active = await checkSubscriptionActive(session);
      return {
        active,
        checkoutUrl: active ? '' : buildCheckoutUrl(session.email, session.userId),
      } satisfies SubscriptionStatus;
    },
    openCheckout: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    evaluateCreative: (images, platform) =>
      callFunction<CreativeEvaluationResult>('evaluate-creative', { images, platform }),
    generateAudio: async (params: AudioGenParams) => {
      const { url } = await callFunction<{ url: string }>('generate-audio', params);
      backupToYandexDisk([url], params.mode === 'music' ? 'music' : 'speech');
      return url;
    },
    connectYandexDisk: async (code: string) => {
      await callFunction('yandex-oauth-exchange', { code });
      try {
        localStorage.setItem(YANDEX_CONNECTED_KEY, '1');
      } catch {
        // Private-browsing/quota edge case — connection still succeeded server-side, the
        // browser just won't remember to auto-backup future generations this session.
      }
      return true;
    },
    isYandexDiskConnected: () => isYandexBackupEnabled(),
    disconnectYandexDisk: () => {
      try {
        localStorage.removeItem(YANDEX_CONNECTED_KEY);
      } catch {
        // Nothing to clean up if storage isn't available.
      }
    },
  };

  window.api = api;
}
