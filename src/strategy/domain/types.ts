// ONEFLOW Marketing Intelligence Engine v4 — domain model.
//
// Built from the "ONEFLOW Marketing Intelligence Master Spec v4 · OpenAI Runtime" document.
// Every entity here is designed to be returned by the OpenAI provider (see
// src/strategy/services/*) as Structured Output, validated against the matching JSON Schema in
// src/strategy/domain/schemas.ts, and never trusted as free text. Exact numeric metrics
// (Economics, Funnel volumes, forecasts) are never AI-authored — see domain/calculators.ts.
//
// This lives alongside the pre-v4 src/strategyTypes.ts during migration; StrategyPanel.tsx and
// friends will move onto this file's types incrementally.

export type EvidenceType = 'fact' | 'research' | 'hypothesis' | 'unknown';
export type EvidenceSourceType = 'user' | 'project' | 'website' | 'connector' | 'web' | 'model';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** spec §8/§43 — the only place a claim can carry provenance. */
export interface Evidence {
  id: string;
  type: EvidenceType;
  sourceType: EvidenceSourceType;
  sourceRef?: string;
  statement: string;
  capturedAt: number;
  confidence: ConfidenceLevel;
  conflictsWith?: string[];
}

export type HypothesisCategory = 'audience' | 'offer' | 'message' | 'channel' | 'creative' | 'funnel';
export type HypothesisStatus = 'untested' | 'testing' | 'supported' | 'rejected' | 'inconclusive';

/** spec §44 */
export interface Hypothesis {
  id: string;
  category: HypothesisCategory;
  statement: string;
  rationale: string[];
  evidenceIds: string[];
  confidence: ConfidenceLevel;
  status: HypothesisStatus;
  experimentIds: string[];
  missingData: string[];
  nextTest?: string;
}

/** spec §6/§29/§88 BusinessUnderstandingResult */
export interface BusinessUnderstanding {
  product: string;
  category: string;
  customerProblem: string;
  value: string;
  differentiators: string[];
  businessModel: string;
  geography: string;
  goal: string;
  solvesTodayVia: string;
  mainPurchaseRisk: string;
  ambiguities: string[];
  evidenceIds: string[];
  missingData: string[];
  confirmed: boolean;
}

export type SegmentPriority = 'now' | 'test' | 'later';

/** spec §12 SegmentationResult — deliberately no decorative personas, only buying-situation criteria. */
export interface Segment {
  id: string;
  name: string;
  buyingSituation: string;
  needFrequency: string;
  abilityToPay: string;
  accessibility: string;
  urgencyTrigger: string;
  productFit: string;
  priority: SegmentPriority;
  priorityRationale: string;
  evidenceIds: string[];
  confidence: ConfidenceLevel;
  assumptions: string[];
}

/** spec §13 JTBDResult — "when [situation], I want [progress], so that [outcome], but [barrier]". */
export interface JTBD {
  id: string;
  segmentId: string;
  situation: string;
  motivation: string;
  desiredOutcome: string;
  alternativesToday: string;
  anxieties: string;
  evidenceIds: string[];
}

/** spec §14 — pain/trigger/barrier/desired outcome, kept separate from JTBD for messaging use. */
export interface PainTriggerBarrier {
  id: string;
  segmentId: string;
  pain: string;
  trigger: string;
  barrier: string;
  desiredOutcome: string;
}

export type PositioningStyle = 'rational' | 'outcome' | 'technological';

/** spec §15 PositioningResult — "for [segment] who needs [job], ONEFLOW is [frame] that [result], unlike [alternative], because [proof]". */
export interface PositioningOption {
  id: string;
  segmentId: string;
  alternative: string;
  value: string;
  reasonToBelieve: string;
  proofNeeded: string;
  style: PositioningStyle;
  evidenceIds: string[];
  isPrimary: boolean;
}

export type OfferMotive = 'speed' | 'savings' | 'simplicity' | 'quality' | 'volume' | 'risk' | 'growth';
export type OfferStatus = 'untested' | 'testing' | 'winner' | 'loser' | 'inconclusive';

/** spec §16 OfferStrategyResult */
export interface OfferHypothesis {
  id: string;
  segmentId: string;
  jtbdId?: string;
  motive: OfferMotive;
  promise: string;
  mechanism: string;
  proof: string;
  objectionHandled: string;
  cta: string;
  evidenceType: EvidenceType;
  confidence: ConfidenceLevel;
  status: OfferStatus;
  experimentNeeded: boolean;
  isPrimary: boolean;
}

export type MessagingStageKey = 'discover' | 'interest' | 'research' | 'try' | 'buy' | 'return';

/** spec §17 — one message per funnel/decision stage. */
export interface MessagingStageEntry {
  stage: MessagingStageKey;
  userQuestion: string;
  messageType: string;
  message: string;
  offerId?: string;
}

export type ChannelFunnelStage = 'awareness' | 'consideration' | 'conversion';
export type HeadroomStatus = 'unknown' | 'has_headroom' | 'at_headroom' | 'saturated';

/** spec §18/§32/§68 ChannelHypothesisResult, with media-planning guardrail fields from Part K. */
export interface ChannelHypothesis {
  id: string;
  channel: string;
  role: string;
  targetSegmentId: string;
  funnelStage: ChannelFunnelStage;
  contentTypes: string[];
  whyTest: string;
  requiredData: string[];
  scaleCriteria: string[];
  pauseCriteria: string[];
  headroomStatus: HeadroomStatus;
  evidenceIds: string[];
  confidence: ConfidenceLevel;
}

export type CreativeArchetype =
  | 'problem_solution'
  | 'demo'
  | 'before_after'
  | 'ugc_testimonial'
  | 'comparison'
  | 'objection_handling'
  | 'offer_led'
  | 'proof_case';

export type CreativeVisualFormat =
  | 'ugc'
  | 'studio'
  | 'product'
  | 'lifestyle'
  | 'demo'
  | 'text_graphic'
  | 'animation'
  | 'catalog'
  | 'not_observable';

export type CreativeIntentStage = 'prospecting' | 'consideration' | 'conversion';
export type FatigueSignal = 'none' | 'watch' | 'confirmed';

/** spec §71 — Content Layer: what the creative *is*, only from observable/declared signals. */
export interface CreativeCardContent {
  hook: string;
  visualFormat: CreativeVisualFormat;
  messagingTheme: string;
  offerId?: string;
  cta: string;
  persona: string;
  intentStage: CreativeIntentStage;
  reuseLongevity?: string;
}

/** spec §72 — Performance Layer: why it works, only from platform-observed metrics. */
export interface CreativeCardPerformance {
  spend?: number;
  ctr?: number;
  cpa?: number;
  cvr?: number;
  frequency?: number;
  hookRate?: number;
  holdRate?: number;
  fatigueSignal: FatigueSignal;
  notObservable: string[];
}

/** spec §73 — Learning Layer: winner-pattern extraction, never from a single ad. */
export interface CreativeCardLearning {
  winnerPattern?: string;
  whatToRemix?: string;
  whatToRetire?: string;
}

export interface CreativeCard {
  id: string;
  archetype: CreativeArchetype;
  content: CreativeCardContent;
  performance: CreativeCardPerformance;
  learning: CreativeCardLearning;
  strategyLinks: {
    audienceId?: string;
    offerId?: string;
    messageStage?: MessagingStageKey;
    hypothesisId?: string;
    experimentId?: string;
  };
  status: 'planned' | 'generated' | 'tested' | 'winner' | 'paused';
  evidenceIds: string[];
}

export type FunnelStepKey = 'saw' | 'interested' | 'checked' | 'tried' | 'bought' | 'returned';

/** spec §21 — simple-mode label always shown; volume/conversion only when observable. */
export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  volume?: number;
  isEstimate: boolean;
  conversionToNext?: number;
}

/** spec §22/§91 — a metric is either computed from real inputs, or explicitly missing its inputs. Never fabricated. */
export interface EconomicsMetric {
  value?: number;
  formula: string;
  missingInputs: string[];
  isEstimate: boolean;
}

export interface Economics {
  cpc: EconomicsMetric;
  cpl: EconomicsMetric;
  cac: EconomicsMetric;
  arpu: EconomicsMetric;
  ltv: EconomicsMetric;
  roas: EconomicsMetric;
  payback: EconomicsMetric;
}

export type ExperimentStatus = 'planned' | 'running' | 'completed' | 'stopped';
export type ExperimentDecision = 'winner' | 'loser' | 'inconclusive';

export interface ExperimentVariant {
  id: string;
  label: string;
  description: string;
}

/** spec §23-25/§45 */
export interface Experiment {
  id: string;
  hypothesisId: string;
  name: string;
  audienceId?: string;
  channelId?: string;
  variants: ExperimentVariant[];
  primaryMetric: string;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  startAt?: number;
  endAt?: number;
  status: ExperimentStatus;
  sampleInfo?: string;
  minDataRule?: string;
  durationRule?: string;
  decisionRule?: string;
  result?: {
    decision: ExperimentDecision;
    summary: string;
  };
  learningId?: string;
}

/** spec §25-26/§46 */
export interface Learning {
  id: string;
  experimentId: string;
  whatHappened: string;
  likelyDrivers: string[];
  unsupportedExplanations: string[];
  evidenceIds: string[];
  confidence: ConfidenceLevel;
  strength: 'strong' | 'moderate' | 'weak';
  affectedStrategyPaths: string[];
  strategyUpdateProposalId?: string;
}

export type ProposalState = 'generated' | 'validated' | 'proposed' | 'accepted' | 'rejected' | 'active' | 'stale' | 'revised';

export interface StrategyChange {
  field: string;
  before: string;
  after: string;
}

/** spec §26/§98 — AI never mutates the strategy directly; this is what Apply/Reject acts on. */
export interface StrategyUpdateProposal {
  id: string;
  changes: StrategyChange[];
  why: string;
  evidenceIds: string[];
  affectedModules: string[];
  requiresUserApproval: boolean;
  rollbackLabel: string;
  state: ProposalState;
  createdAt: number;
}

export type MessageMatchStatus = 'match' | 'partial' | 'mismatch' | 'not_checked';

/** spec §75-76 — Landing Page Message Match. Manually entered (no live page-fetch tool wired up); the
 * match/mismatch classification itself is still deterministic keyword-overlap, never an AI guess. */
export interface LandingAudit {
  adPromise: string;
  landingHeadline: string;
  landingAboveFold: string;
  status: MessageMatchStatus;
  notes: string;
  checkedAt: number;
}

export interface ReadinessItem {
  label: string;
  done: boolean;
}

export interface ReadinessBlocker {
  label: string;
  actionLabel?: string;
}

/** spec §36 — replaces the raw numeric Strategy Score as the default sidebar/header state. */
export interface Readiness {
  items: ReadinessItem[];
  blockers: ReadinessBlocker[];
  nextStepLabel: string;
}

export type ActionPlanStatus = 'proven' | 'testing' | 'no_data';

/** spec §34 — the 30-day plan, each task tagged with its evidence status (spec §78). */
export interface ActionPlanTask {
  id: string;
  week: number;
  goal: string;
  action: string;
  expectedResult: string;
  status: ActionPlanStatus;
  done: boolean;
}

export type StrategyHistoryEventType =
  | 'generate'
  | 'manual_edit'
  | 'ai_proposal_applied'
  | 'ai_proposal_rejected'
  | 'learning_applied'
  | 'revert';

export interface StrategyHistoryEvent {
  id: string;
  timestamp: number;
  type: StrategyHistoryEventType;
  description: string;
  oldValue?: string;
  newValue?: string;
  rationale?: string;
  proposalId?: string;
}

/** spec §42 — the top-level Strategy aggregate. */
export interface StrategyV4 {
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  objective: string;
  market: string;
  locale: string;
  budget: number;
  currency: string;
  periodMonths: number;

  businessUnderstanding: BusinessUnderstanding | null;
  evidence: Evidence[];
  segments: Segment[];
  jtbd: JTBD[];
  painTriggerBarriers: PainTriggerBarrier[];
  positioningOptions: PositioningOption[];
  offers: OfferHypothesis[];
  messaging: MessagingStageEntry[];
  channels: ChannelHypothesis[];
  creativeCards: CreativeCard[];
  funnel: FunnelStep[];
  economics: Economics;
  experiments: Experiment[];
  learnings: Learning[];
  actionPlan: ActionPlanTask[];
  readiness: Readiness;
  proposals: StrategyUpdateProposal[];
  history: StrategyHistoryEvent[];
  /** spec §75-76 — Landing Page Message Match; null until the user runs an audit. */
  landingAudit: LandingAudit | null;

  /** dependency-graph staleness (spec §48/§95) — keys are module names ("segments", "offers", ...). */
  staleModules: string[];

  createdAt: number;
  updatedAt: number;
}

export function primaryOffer(offers: OfferHypothesis[]): OfferHypothesis | undefined {
  return offers.find((o) => o.isPrimary) ?? offers[0];
}

export function primaryPositioning(options: PositioningOption[]): PositioningOption | undefined {
  return options.find((p) => p.isPrimary) ?? options[0];
}

export function segmentById(strategy: StrategyV4, id: string | undefined): Segment | undefined {
  return id ? strategy.segments.find((s) => s.id === id) : undefined;
}

export function evidenceByIds(strategy: StrategyV4, ids: string[]): Evidence[] {
  return ids.map((id) => strategy.evidence.find((e) => e.id === id)).filter((e): e is Evidence => Boolean(e));
}
