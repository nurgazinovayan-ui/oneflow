// Shape of a row in the Supabase table trend_watch_items, as written by the
// trendswatch-refresh Edge Function.
export type TrendPlatform = 'tiktok' | 'instagram' | 'threads';

// region_rank as written by the collector: 1 CIS, 2 Europe, 3 Americas, 4 undetermined.
export const REGION_RANKS = { cis: 1, europe: 2, america: 3, unknown: 4 } as const;
export type TrendRegion = keyof typeof REGION_RANKS;

export interface TrendWatchItem {
  id: string;
  platform: TrendPlatform;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  author: string | null;
  stats: { views?: number; likes?: number; shares?: number; comments?: number } | null;
  ai_advice: string | null;
  popularity_score: number;
  region_rank: number;
  fetch_date: string;
  fetched_at: string;
}
