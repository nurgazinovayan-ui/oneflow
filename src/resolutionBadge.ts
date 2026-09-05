// Small corner "1K/2K/4K" badge shown on generated-media tiles (QuickGenPanel, AssetsPanel) —
// a coarse, consistent read of output resolution regardless of which model made it, since the
// underlying models report resolution in very different shapes (Nano Banana's literal "1K"/"2K"/
// "4K", GPT Image 2's quality tiers, video models' "720p"/"1080p").
export type ResolutionTier = '1K' | '2K' | '4K';

const QUALITY_TIER_MAP: Record<string, ResolutionTier> = {
  auto: '1K',
  low: '1K',
  medium: '2K',
  high: '4K',
};

const VIDEO_RESOLUTION_MAP: Record<string, ResolutionTier> = {
  '480p': '1K',
  '720p': '1K',
  '1080p': '2K',
  '1440p': '2K',
  '2160p': '4K',
};

// From a model's own reported resolution/quality value (QuickGenPanel already has this on every
// entry — no need to measure pixels).
export function resolutionTierFromModelValue(value: string): ResolutionTier {
  const upper = value.toUpperCase();
  if (upper === '1K' || upper === '2K' || upper === '4K') return upper as ResolutionTier;
  const lower = value.toLowerCase();
  return QUALITY_TIER_MAP[lower] ?? VIDEO_RESOLUTION_MAP[lower] ?? '1K';
}

// From actual measured pixel dimensions (AssetsPanel, which only has the file itself — Yandex
// Disk's listing carries no model metadata) — bucketed by the longer edge.
export function resolutionTierFromPixels(maxDimensionPx: number): ResolutionTier {
  if (maxDimensionPx > 2560) return '4K';
  if (maxDimensionPx > 1280) return '2K';
  return '1K';
}
