// Selective recomputation — spec §48/§95. Explicit stale-propagation rules per changed module,
// not a full re-generate. "Do NOT recompute raw website evidence or unrelated historical
// experiment results" (spec §95) — anything not listed here stays untouched.

import type { StrategyV4 } from './types';

export type StrategyModule =
  | 'businessUnderstanding'
  | 'segments'
  | 'jtbd'
  | 'positioning'
  | 'offers'
  | 'messaging'
  | 'channels'
  | 'creative'
  | 'funnel'
  | 'economics'
  | 'experiments'
  | 'actionPlan';

/** What becomes stale when the given module changes — spec §48's three worked examples, encoded literally. */
const STALE_RULES: Partial<Record<StrategyModule, StrategyModule[]>> = {
  businessUnderstanding: ['segments', 'positioning', 'offers', 'channels', 'creative'],
  segments: ['jtbd', 'offers', 'messaging', 'channels', 'creative'],
  offers: ['messaging', 'creative', 'experiments'],
  channels: ['creative'],
};

export function staleModulesAfterChange(changed: StrategyModule): StrategyModule[] {
  return STALE_RULES[changed] ?? [];
}

export function markStale(strategy: StrategyV4, changedModule: StrategyModule): StrategyV4 {
  const newlyStale = staleModulesAfterChange(changedModule);
  if (newlyStale.length === 0) return strategy;
  return { ...strategy, staleModules: Array.from(new Set([...strategy.staleModules, ...newlyStale])) };
}

export function clearStale(strategy: StrategyV4, module: StrategyModule): StrategyV4 {
  if (!strategy.staleModules.includes(module)) return strategy;
  return { ...strategy, staleModules: strategy.staleModules.filter((m) => m !== module) };
}

export function isStale(strategy: StrategyV4, module: StrategyModule): boolean {
  return strategy.staleModules.includes(module);
}
