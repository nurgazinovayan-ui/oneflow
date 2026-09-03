// Data model for the "Стратегия" (Strategy) mode — see StrategyPanel.tsx and its child
// components. A strategy is generated once from a short brief (goal/market/budget/duration +
// product description or photo) by a single AI call (buildStrategyPrompt in strategyPrompts.ts)
// that returns this whole shape as JSON, then lives in React state for the active session (not
// persisted to a project file — there's no backend schema for it yet, unlike node-canvas
// projects which save via ProjectFile).

export type StrategyGoal = 'sales' | 'leads' | 'awareness';

export interface StrategyBrief {
  goal: StrategyGoal;
  market: string;
  durationMonths: number;
  budget: number;
  currency: string;
  productDescription: string;
  photo?: string | null;
}

export interface AudienceSegment {
  name: string;
  potential: 'High' | 'Medium' | 'Low';
  description: string;
  painPoints: string[];
}

export interface ChannelAllocation {
  name: string;
  percent: number;
}

export interface ContentMatrixRow {
  format: string;
  // Which funnel stages this content format is recommended for.
  stages: ('awareness' | 'consideration' | 'conversion')[];
}

export interface FunnelStage {
  label: string;
  value: number;
  // Conversion rate to the NEXT stage, omitted on the last stage.
  conversionToNext?: number;
}

export interface StrategyNote {
  title: string;
  description: string;
}

export interface PlanTask {
  day: string;
  title: string;
  tag: string;
}

export interface StrategyScoreBreakdown {
  overall: number;
  audience: number;
  positioning: number;
  offer: number;
  channels: number;
  content: number;
  retention: number;
}

export interface StrategyData {
  title: string;
  positioning: string;
  offer: string;
  score: StrategyScoreBreakdown;
  audience: AudienceSegment[];
  channels: ChannelAllocation[];
  risks: StrategyNote[];
  opportunities: StrategyNote[];
  contentMatrix: ContentMatrixRow[];
  funnel: FunnelStage[];
  plan: PlanTask[];
  topInsight: StrategyNote;
}

export const STRATEGY_GOAL_LABELS: Record<StrategyGoal, { ru: string; en: string }> = {
  sales: { ru: 'Продажи', en: 'Sales' },
  leads: { ru: 'Лиды', en: 'Leads' },
  awareness: { ru: 'Узнаваемость', en: 'Awareness' },
};
