// Deterministic math for Strategy mode — per spec Part III (§16 Score, §18 Forecast, §19
// Scenario), nothing here is an AI call. AI proposes hypotheses (component scores, channel
// rationale, CPC ranges); this file turns them into the one recomputed number the UI shows, so
// edits (a funnel rate, a channel %) recompute deterministically instead of re-asking the model.

import type {
  ChannelAllocation,
  FunnelStage,
  StrategyBrief,
  StrategyData,
  StrategyScoreBreakdown,
} from './strategyTypes';
import { SCORE_WEIGHTS } from './strategyTypes';

export function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// StrategyScore = Σ(componentScore × weight) — spec §16. Components themselves are the AI's own
// qualitative 0-100 judgement (kept in StrategyData.scoreBreakdown); this is the one place the
// overall number is derived, so it can never silently drift from that formula.
export function computeOverallScore(breakdown: StrategyScoreBreakdown): number {
  const sum = (Object.keys(SCORE_WEIGHTS) as (keyof StrategyScoreBreakdown)[]).reduce(
    (acc, key) => acc + breakdown[key] * SCORE_WEIGHTS[key],
    0
  );
  return Math.round(sum);
}

// Deterministic downstream funnel recompute — spec §11:
// stage[n].volume = round(stage[n-1].volume × conversionRate[n])
export function recomputeFunnel(stages: FunnelStage[], changedIndex: number, newRate: number): FunnelStage[] {
  const clamped = Math.max(0, Math.min(100, newRate));
  const next = stages.map((s) => ({ ...s }));
  next[changedIndex].conversionToNext = clamped;
  next[changedIndex].assumptionSource = 'user';
  next[changedIndex].confidence = 100;
  for (let i = changedIndex + 1; i < next.length; i++) {
    const prev = next[i - 1];
    const rate = prev.conversionToNext ?? 0;
    next[i].volume = Math.round(prev.volume * (rate / 100));
  }
  return next;
}

export function allocationSum(channels: ChannelAllocation[]): number {
  return Math.round(channels.reduce((acc, c) => acc + c.percent, 0));
}

export interface ChannelForecast {
  channelId: string;
  spend: number;
  clicksMin?: number;
  clicksMax?: number;
  insufficientData: boolean;
}

// Deterministic forecast per spec §18 — code computes it, AI only ever supplies the CPC range
// (as a range, never a single fabricated number) on ChannelAllocation.cpcRange. No cpcRange ⇒
// "Недостаточно данных", never a guessed click count.
export function computeChannelForecast(budget: number, channel: ChannelAllocation): ChannelForecast {
  const spend = Math.round((budget * channel.percent) / 100);
  if (!channel.cpcRange || channel.cpcRange.min <= 0) {
    return { channelId: channel.id, spend, insufficientData: true };
  }
  return {
    channelId: channel.id,
    spend,
    clicksMin: Math.round(spend / channel.cpcRange.max),
    clicksMax: Math.round(spend / channel.cpcRange.min),
    insufficientData: false,
  };
}

export type ScenarioId = 'main' | 'aggressive' | 'lean';

export interface ScenarioSummary {
  id: ScenarioId;
  budget: number;
  // Purchases estimate scaled linearly off the current funnel's final-stage volume — a rough,
  // clearly-labeled heuristic (spec §19 forbids stating a growth % the model has no basis for),
  // not a real attribution/ML forecast.
  purchasesEstimate: number;
  growthPercent: number;
  cac: number | null;
  risk: 'Low' | 'Medium' | 'High';
}

const SCENARIO_MULTIPLIER: Record<ScenarioId, number> = { main: 1, aggressive: 2, lean: 0.4 };
const SCENARIO_RISK: Record<ScenarioId, ScenarioSummary['risk']> = { main: 'Medium', aggressive: 'High', lean: 'Low' };

export function buildScenarios(data: StrategyData, brief: StrategyBrief): ScenarioSummary[] {
  const lastStage = data.funnel[data.funnel.length - 1];
  const basePurchases = lastStage?.volume ?? 0;
  return (['main', 'aggressive', 'lean'] as ScenarioId[]).map((id) => {
    const multiplier = SCENARIO_MULTIPLIER[id];
    const budget = Math.round(brief.budget * multiplier);
    const purchasesEstimate = Math.round(basePurchases * multiplier);
    const growthPercent = id === 'main' ? 0 : Math.round((multiplier - 1) * 100);
    return {
      id,
      budget,
      purchasesEstimate,
      growthPercent,
      cac: purchasesEstimate > 0 ? Math.round(budget / purchasesEstimate) : null,
      risk: SCENARIO_RISK[id],
    };
  });
}
