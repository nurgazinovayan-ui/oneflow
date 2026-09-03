// Data model for the "Стратегия" (Strategy) mode — see StrategyPanel.tsx and its child
// components. Rebuilt against the Master Spec: Strategy is a single connected domain object
// (audience/positioning/offers/channels/content/funnel/journey/kpis/plan/score), not a set of
// independent AI text blocks — editing one entity (funnel rate, channel %, primary offer) is a
// deterministic recompute of just its dependents, not a full AI regenerate.
//
// Still session-only, not persisted to a project file — there is no backend schema for Strategy
// yet, unlike node-canvas projects which save via ProjectFile. Everything here is designed so a
// real persistence layer could be added later without reshaping the model (id fields, a
// version/updatedAt-shaped history log, immutable StrategyContextSnapshot for generation) even
// though this pass keeps it all in React state for the session.

export type StrategyGoal = 'sales' | 'leads' | 'awareness';

export interface StrategyBrief {
  goal: StrategyGoal;
  market: string;
  durationMonths: number;
  budget: number;
  currency: string;
  productDescription: string;
  photo?: string | null;
  // Optional context per spec section 4 — collected but not fetched/analyzed (no backend
  // endpoint exists to crawl an arbitrary URL or research competitors), passed to the AI as
  // free-text hints only.
  websiteUrl?: string;
  competitors?: string;
  knownAudience?: string;
}

// source_type per spec section 17 — provenance of an AI hypothesis. Every AI-generated
// hypothesis in this session is 'ai_assumption'; the other values exist so the model/UI already
// has a place to show a real value if a future integration supplies one (user-entered, imported
// from a site, computed from ONEFLOW's own history, or a genuine external benchmark).
export type SourceType = 'user' | 'imported' | 'historical' | 'benchmark' | 'ai_assumption';

export interface AudienceSegment {
  id: string;
  name: string;
  potential: 'High' | 'Medium' | 'Low';
  description: string;
  mainJob: string;
  painPoints: string[];
  purchaseTriggers: string[];
  objections: string[];
  recommendedMessage: string;
  confidence: number; // 0-100
  sourceType: SourceType;
}

export interface PositioningAlternative {
  id: string;
  label: string; // e.g. "Rational", "Emotional", "Technological"
  statement: string;
}

export interface Positioning {
  primaryStatement: string;
  valueProposition: string;
  reasonsToBelieve: string[];
  differentiators: string[];
  tone: string;
  alternatives: PositioningAlternative[];
  confidence: number;
}

export type FunnelStageKey = 'awareness' | 'consideration' | 'conversion';

export interface Offer {
  id: string;
  text: string;
  angle: string;
  targetSegmentId?: string;
  funnelStage: FunnelStageKey;
  score: number; // heuristic/AI offer score, 0-100 — never shown as real performance
  isPrimary: boolean;
}

export interface ChannelAllocation {
  id: string;
  name: string;
  percent: number;
  rationale: string;
  confidence: number;
  // Set only when a benchmark/user CPC is known — kept as a range per spec section 18
  // ("предпочтительнее диапазоны, а не точное число"). Absent means "insufficient data".
  cpcRange?: { min: number; max: number };
}

export type ContentStatus = 'planned' | 'generated' | 'tested' | 'winner' | 'paused';
export type ContentPriority = 'high' | 'medium' | 'low';

export interface ContentMatrixRow {
  id: string;
  format: string;
  stages: FunnelStageKey[]; // which funnel-stage columns this format lights up in the matrix
  audienceId?: string;
  objective: string;
  hook: string;
  message: string;
  cta: string;
  recommendedAssets: string[];
  priority: ContentPriority;
  status: ContentStatus;
  scoredCount: number;
  averageScore?: number;
  bestScore?: number;
}

export interface FunnelStage {
  id: string;
  label: string;
  volume: number;
  // Conversion rate from THIS stage to the next one — undefined on the last stage.
  conversionToNext?: number;
  assumptionSource: SourceType;
  confidence: number;
}

export type JourneyStageKey = 'discover' | 'interest' | 'research' | 'try' | 'buy' | 'return';

export interface JourneyStep {
  stage: JourneyStageKey;
  customerThought: string;
  message: string;
  channel: string;
  content: string;
  cta: string;
}

export interface Kpi {
  id: string;
  label: string;
  target: string;
  unit: string;
}

export type PlanTaskType = 'generate' | 'score' | 'compare' | 'manual' | 'review';

export interface PlanTask {
  id: string;
  day: string;
  title: string;
  tag: string;
  type: PlanTaskType;
  done: boolean;
}

// Structured action payload per spec section 20 — the ONLY way Assistant/Insight changes are
// ever applied. Free text is never parsed into a mutation; see strategyActions.ts.
export type StrategyActionType =
  | 'reallocate_budget'
  | 'set_primary_positioning'
  | 'set_primary_offer'
  | 'update_funnel_rate'
  | 'apply_risk'
  | 'apply_opportunity'
  | 'dismiss_insight';

export interface StrategyAction {
  type: StrategyActionType;
  rationale?: string;
  channelChanges?: { channelId: string; allocation: number }[];
  positioningAlternativeId?: string;
  offerId?: string;
  funnelStageId?: string;
  newRate?: number;
  insightId?: string;
}

export type InsightStatus = 'active' | 'applied' | 'dismissed';

export interface StrategyInsight {
  id: string;
  title: string;
  description: string;
  evidence: string;
  affectedEntities: string[];
  action?: StrategyAction;
  status: InsightStatus;
}

export interface StrategyNote {
  title: string;
  description: string;
}

export interface Assumption {
  id: string;
  field: string;
  value: string;
  confidenceLabel: string;
}

export interface HistoryEvent {
  id: string;
  timestamp: number;
  type: StrategyActionType | 'generate' | 'manual_edit';
  description: string;
  oldValue?: string;
  newValue?: string;
  rationale?: string;
}

export interface StrategyScoreBreakdown {
  audience: number;
  positioning: number;
  offer: number;
  channels: number;
  content: number;
  funnel: number;
  retention: number;
  measurement: number;
}

// Weights per spec section 16 — sum to 1.00. Kept next to the type so
// strategyCompute.computeOverallScore can't drift out of sync with the shape above.
export const SCORE_WEIGHTS: Record<keyof StrategyScoreBreakdown, number> = {
  audience: 0.15,
  positioning: 0.15,
  offer: 0.15,
  channels: 0.15,
  content: 0.15,
  funnel: 0.1,
  retention: 0.1,
  measurement: 0.05,
};

export interface StrategyData {
  title: string;
  goalSummary: string; // e.g. "Increase paid conversions by 25% in 3 months"
  positioning: Positioning;
  offers: Offer[];
  scoreBreakdown: StrategyScoreBreakdown;
  audience: AudienceSegment[];
  competitors: string[];
  channels: ChannelAllocation[];
  contentMatrix: ContentMatrixRow[];
  funnel: FunnelStage[];
  journey: JourneyStep[];
  kpis: Kpi[];
  risks: StrategyInsight[];
  opportunities: StrategyInsight[];
  plan: PlanTask[];
  topInsight: StrategyNote;
  assumptions: Assumption[];
  history: HistoryEvent[];
}

export function primaryOffer(offers: Offer[]): Offer | undefined {
  return offers.find((o) => o.isPrimary) ?? offers[0];
}

export const STRATEGY_GOAL_LABELS: Record<StrategyGoal, { ru: string; en: string }> = {
  sales: { ru: 'Продажи', en: 'Sales' },
  leads: { ru: 'Лиды', en: 'Leads' },
  awareness: { ru: 'Узнаваемость', en: 'Awareness' },
};
