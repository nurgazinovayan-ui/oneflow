import { create } from 'zustand';
import type { CreditBalance } from './types';

// Credit balance shared by the toolbar ring, the home screen and the top-up window, so a refresh in
// one place updates all three. Web only — on desktop window.api.getCredits is absent and nothing
// here is used.

const POLL_MS = 15000;

interface CreditsState {
  balance: CreditBalance | null;
  topUpOpen: boolean;
  refresh: () => Promise<void>;
  openTopUp: () => void;
  closeTopUp: () => void;
}

export const useCredits = create<CreditsState>((set) => ({
  balance: null,
  topUpOpen: false,
  refresh: async () => {
    if (!window.api.getCredits) return;
    try {
      set({ balance: await window.api.getCredits() });
    } catch {
      // keep the last known balance; the next poll retries
    }
  },
  openTopUp: () => set({ topUpOpen: true }),
  closeTopUp: () => set({ topUpOpen: false }),
}));

let pollers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** Starts polling while at least one component showing the balance is mounted. */
export function subscribeCredits(): () => void {
  pollers += 1;
  if (pollers === 1) {
    void useCredits.getState().refresh();
    timer = setInterval(() => void useCredits.getState().refresh(), POLL_MS);
  }
  return () => {
    pollers -= 1;
    if (pollers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Credits a top-up of `usd` buys under the server's tiers (mirrors credits_for_topup()). */
export function creditsForTopUp(usd: number, tiers: CreditBalance['topup']['tiers']): number {
  const rate = [...tiers].sort((a, b) => b.fromUsd - a.fromUsd).find((t) => usd >= t.fromUsd)?.perUsd ?? tiers[0]?.perUsd ?? 0;
  return Math.floor(usd * rate);
}

/** Slider stops: fine steps for small amounts, coarser for large ones. */
export function topUpStops(min: number, max: number): number[] {
  const base = [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
  const stops = base.filter((v) => v >= min && v <= max);
  if (!stops.includes(min)) stops.unshift(min);
  if (!stops.includes(max)) stops.push(max);
  return stops;
}

// What a credit buys, for the "≈ N images" hints, from the price tables in the generate-* functions
// (1 credit = 1 cent). The landing's pricing block (v5_ice.TOPUP_EQ) uses the same three, so both
// show the same numbers.
export const CREDIT_EXAMPLES = {
  image: 4, // Nano Banana 2.1, 1K ($0.0336)
  video5s: 63, // Kling 3.0, 720p, 5 s ($0.126/s)
  music: 8, // Lyria 3 Pro, one track ($0.08)
};
