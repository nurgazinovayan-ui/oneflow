import type { AppView } from './modes';

// Home-screen banner slides, edited in the admin panel (oneflow.art/admin → «Баннеры приложения»)
// and stored as one JSON row in the public `site_content` table under BANNERS_KEY. Everything read
// from there is treated as untrusted: media must live in our own public storage bucket (or be a
// same-origin path), links are either one of the app's modes or a plain https:// URL, and texts are
// rendered as text (never as HTML).

export const BANNERS_KEY = 'app.home.banners';
const MEDIA_BUCKET = 'site-media';
const CACHE_KEY = 'oneflow-home-banners';
const MAX_SLIDES = 12;
const MAX_TEXT = 400;

export type BannerLink = { kind: 'mode'; view: AppView } | { kind: 'url'; href: string };

export interface BannerSlide {
  id: string;
  mediaType: 'image' | 'video';
  media: string;
  poster?: string;
  tag: string;
  title: string;
  text: string;
  button: string;
  link: BannerLink | null;
}

interface StoredText {
  tag?: unknown;
  title?: unknown;
  text?: unknown;
  button?: unknown;
}

interface StoredSlide {
  id?: unknown;
  type?: unknown;
  media?: unknown;
  poster?: unknown;
  link?: unknown;
  ru?: StoredText;
  en?: StoredText;
}

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

const str = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function safeMedia(v: unknown): string | null {
  const s = str(v, 1000);
  if (!s) return null;
  // Same-origin file shipped with the app (e.g. /oneflow-hero.webm), never protocol-relative.
  if (s.startsWith('/') && !s.startsWith('//') && !s.includes('\\')) return s;
  if (!SUPABASE_URL) return null;
  try {
    const url = new URL(s);
    const base = new URL(SUPABASE_URL);
    if (url.protocol === 'https:' && url.origin === base.origin && url.pathname.startsWith(`/storage/v1/object/public/${MEDIA_BUCKET}/`)) {
      return url.toString();
    }
  } catch {
    // not a URL
  }
  return null;
}

function safeLink(v: unknown, views: readonly AppView[]): BannerLink | null {
  const s = str(v, 1000);
  if (!s) return null;
  if (s.startsWith('mode:')) {
    const view = s.slice(5) as AppView;
    return views.includes(view) ? { kind: 'mode', view } : null;
  }
  try {
    const url = new URL(s);
    return url.protocol === 'https:' ? { kind: 'url', href: url.toString() } : null;
  } catch {
    return null;
  }
}

/** Parses the stored JSON into slides for one language; anything malformed is dropped. */
export function parseBanners(raw: string, language: 'ru' | 'en', views: readonly AppView[]): BannerSlide[] {
  let data: { slides?: unknown };
  try {
    data = JSON.parse(raw) as { slides?: unknown };
  } catch {
    return [];
  }
  if (!data || !Array.isArray(data.slides)) return [];
  const out: BannerSlide[] = [];
  for (const item of data.slides.slice(0, MAX_SLIDES) as StoredSlide[]) {
    if (!item || typeof item !== 'object') continue;
    const media = safeMedia(item.media);
    if (!media) continue;
    const mediaType = item.type === 'video' ? 'video' : 'image';
    const own = (item[language] ?? {}) as StoredText;
    const other = (item[language === 'ru' ? 'en' : 'ru'] ?? {}) as StoredText;
    const pick = (k: keyof StoredText) => str(own[k]) || str(other[k]);
    out.push({
      id: str(item.id, 64) || `s${out.length}`,
      mediaType,
      media,
      poster: mediaType === 'video' ? safeMedia(item.poster) ?? undefined : undefined,
      tag: pick('tag'),
      title: pick('title'),
      text: pick('text'),
      button: pick('button'),
      link: safeLink(item.link, views),
    });
  }
  return out;
}

export function readCachedBanners(): string | null {
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

/**
 * Fetches the stored banner JSON (public read with the publishable key). Resolves to the raw JSON
 * string, '' when nothing is configured, or null when the request failed.
 */
export async function fetchBanners(signal?: AbortSignal): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/site_content?select=value&key=eq.${encodeURIComponent(BANNERS_KEY)}`;
    // Same request the landing makes for its own texts: publishable key in the apikey header only.
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY }, signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as { value?: unknown }[];
    const value = Array.isArray(rows) && typeof rows[0]?.value === 'string' ? (rows[0].value as string) : '';
    try {
      if (value) localStorage.setItem(CACHE_KEY, value);
      else localStorage.removeItem(CACHE_KEY);
    } catch {
      // storage unavailable — the banner just won't be cached for the next visit
    }
    return value;
  } catch {
    return null;
  }
}
