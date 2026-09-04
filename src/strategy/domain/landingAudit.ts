// spec §75-76 — Landing Page Message Match. No live page-fetch tool is wired into this build, so
// the ad promise / landing copy are entered manually; the match classification itself is still a
// deterministic keyword-overlap check, never an AI guess dressed up as a measurement.

import type { MessageMatchStatus } from './types';

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

export function classifyMessageMatch(adPromise: string, landingHeadline: string, landingAboveFold: string): MessageMatchStatus {
  const adWords = normalizeWords(adPromise);
  const landingWords = new Set([...normalizeWords(landingHeadline), ...normalizeWords(landingAboveFold)]);
  if (adWords.size === 0 || landingWords.size === 0) return 'not_checked';
  let overlap = 0;
  for (const w of adWords) if (landingWords.has(w)) overlap++;
  const ratio = overlap / adWords.size;
  if (ratio >= 0.4) return 'match';
  if (ratio >= 0.15) return 'partial';
  return 'mismatch';
}
