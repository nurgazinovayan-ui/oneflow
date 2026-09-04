// Deterministic calculators — spec §22/§68-70/§90-91.
//
// "OpenAI never calculates" is the load-bearing rule of the whole v4 architecture (spec §90):
// every exact number here is arithmetic on inputs the caller supplies, never a guess. When an
// input is missing, functions return `undefined`/an empty range plus the missing-input list
// instead of substituting a default — silently treating missing data as zero is explicitly
// forbidden (spec §80).

import type { ConfidenceLevel, Evidence, EvidenceSourceType, EconomicsMetric, FunnelStep } from './types';

function metric(value: number | undefined, formula: string, missingInputs: string[]): EconomicsMetric {
  return { value, formula, missingInputs, isEstimate: missingInputs.length > 0 };
}

function safeDivide(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------------------------
// UnitEconomicsCalculator — spec §22/§91
// ---------------------------------------------------------------------------------------------

export const UnitEconomicsCalculator = {
  cpc(adSpend?: number, clicks?: number): EconomicsMetric {
    const missing = [!adSpend ? 'adSpend' : null, !clicks ? 'clicks' : null].filter((x): x is string => Boolean(x));
    return metric(safeDivide(adSpend, clicks), 'CPC = adSpend / clicks', missing);
  },
  cpl(adSpend?: number, leads?: number): EconomicsMetric {
    const missing = [!adSpend ? 'adSpend' : null, !leads ? 'leads' : null].filter((x): x is string => Boolean(x));
    return metric(safeDivide(adSpend, leads), 'CPL = adSpend / leads', missing);
  },
  cac(acquisitionSpend?: number, newPayingCustomers?: number): EconomicsMetric {
    const missing = [!acquisitionSpend ? 'acquisitionSpend' : null, !newPayingCustomers ? 'newPayingCustomers' : null].filter(
      (x): x is string => Boolean(x)
    );
    return metric(safeDivide(acquisitionSpend, newPayingCustomers), 'CAC = acquisitionSpend / newPayingCustomers', missing);
  },
  arpu(revenue?: number, activePayingUsers?: number): EconomicsMetric {
    const missing = [!revenue ? 'revenue' : null, !activePayingUsers ? 'activePayingUsers' : null].filter(
      (x): x is string => Boolean(x)
    );
    return metric(safeDivide(revenue, activePayingUsers), 'ARPU = revenue / activePayingUsers', missing);
  },
  /** LTV needs an explicit model — here: ARPU × avg. lifetime (months). Formula/version is always stored alongside the value. */
  ltv(arpu?: number, avgLifetimeMonths?: number): EconomicsMetric {
    const missing = [!arpu ? 'arpu' : null, !avgLifetimeMonths ? 'avgLifetimeMonths' : null].filter(
      (x): x is string => Boolean(x)
    );
    const value = arpu !== undefined && avgLifetimeMonths !== undefined ? arpu * avgLifetimeMonths : undefined;
    return metric(value, 'LTV = ARPU × avgLifetimeMonths (simple model v1)', missing);
  },
  roas(attributedRevenue?: number, adSpend?: number): EconomicsMetric {
    const missing = [!attributedRevenue ? 'attributedRevenue' : null, !adSpend ? 'adSpend' : null].filter(
      (x): x is string => Boolean(x)
    );
    return metric(safeDivide(attributedRevenue, adSpend), 'ROAS = attributedRevenue / adSpend', missing);
  },
  payback(cac?: number, contributionMarginPerPeriod?: number): EconomicsMetric {
    const missing = [!cac ? 'cac' : null, !contributionMarginPerPeriod ? 'contributionMarginPerPeriod' : null].filter(
      (x): x is string => Boolean(x)
    );
    return metric(safeDivide(cac, contributionMarginPerPeriod), 'Payback = CAC / contributionMarginPerPeriod', missing);
  },
};

// ---------------------------------------------------------------------------------------------
// FunnelCalculator — spec §21
// ---------------------------------------------------------------------------------------------

export const FunnelCalculator = {
  stepConversion(from?: number, to?: number): number | undefined {
    return from && from > 0 && to !== undefined ? Math.round((to / from) * 1000) / 10 : undefined;
  },
  cumulativeConversion(steps: FunnelStep[]): number | undefined {
    const first = steps[0]?.volume;
    const last = steps[steps.length - 1]?.volume;
    return FunnelCalculator.stepConversion(first, last);
  },
  /** Recompute volume + conversionToNext forward from a user-edited step, same cascade rule as the pre-v4 funnel editor. */
  propagateVolume(steps: FunnelStep[], changedIndex: number, newConversionPercent: number): FunnelStep[] {
    const next = steps.map((s) => ({ ...s }));
    next[changedIndex] = { ...next[changedIndex], conversionToNext: newConversionPercent, isEstimate: false };
    for (let i = changedIndex; i < next.length - 1; i++) {
      const rate = next[i].conversionToNext;
      const prevVolume = next[i].volume;
      if (rate !== undefined && prevVolume !== undefined) {
        next[i + 1] = { ...next[i + 1], volume: Math.round((prevVolume * rate) / 100) };
      }
    }
    return next;
  },
};

// ---------------------------------------------------------------------------------------------
// BudgetCalculator — spec §19 starting framework (testing budget, not "optimal" budget)
// ---------------------------------------------------------------------------------------------

export interface BudgetFramework {
  testing: number;
  scalingWinners: number;
  newExperiments: number;
  reserve: number;
}

export const BudgetCalculator = {
  /** Default 40/40/10/10 starting split — explicitly a learning-budget framework, editable, never presented as an optimum. */
  startingFramework(totalBudget: number): BudgetFramework {
    return {
      testing: Math.round(totalBudget * 0.4),
      scalingWinners: Math.round(totalBudget * 0.4),
      newExperiments: Math.round(totalBudget * 0.1),
      reserve: Math.round(totalBudget * 0.1),
    };
  },
  scenarioDiff(a: BudgetFramework, b: BudgetFramework): BudgetFramework {
    return {
      testing: b.testing - a.testing,
      scalingWinners: b.scalingWinners - a.scalingWinners,
      newExperiments: b.newExperiments - a.newExperiments,
      reserve: b.reserve - a.reserve,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// ForecastCalculator — Part K §68: range + headroom, never a point estimate
// ---------------------------------------------------------------------------------------------

export interface ForecastRange {
  low: number;
  high: number;
  assumptions: string[];
  confidence: ConfidenceLevel;
  headroomStatus: 'unknown' | 'has_headroom' | 'at_headroom' | 'saturated';
}

export const ForecastCalculator = {
  /** Forecast = baselineRate × seasonality × scalingAdjustment, widened by low confidence / long horizon / above-headroom scaling. */
  range(input: {
    baselineRate: number;
    seasonality: number;
    scalingAdjustment: number;
    confidence: ConfidenceLevel;
    horizonMonths: number;
    headroomStatus: 'unknown' | 'has_headroom' | 'at_headroom' | 'saturated';
    assumptions: string[];
  }): ForecastRange {
    const center = input.baselineRate * input.seasonality * input.scalingAdjustment;
    let widthPct = 0.15;
    if (input.confidence === 'medium') widthPct += 0.15;
    if (input.confidence === 'low') widthPct += 0.35;
    widthPct += Math.max(0, input.horizonMonths - 1) * 0.05;
    if (input.headroomStatus === 'at_headroom') widthPct += 0.2;
    if (input.headroomStatus === 'saturated') widthPct += 0.4;
    if (input.headroomStatus === 'unknown') widthPct += 0.15;
    return {
      low: Math.round(center * (1 - widthPct)),
      high: Math.round(center * (1 + widthPct)),
      assumptions: input.assumptions,
      confidence: input.confidence,
      headroomStatus: input.headroomStatus,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// ExperimentCalculator — spec §24, statistical/practical significance, never trusted to the model
// ---------------------------------------------------------------------------------------------

export interface ExperimentReadout {
  liftPercent: number | undefined;
  statisticallySignificant: boolean;
  practicallyMeaningful: boolean;
  decision: 'winner' | 'loser' | 'inconclusive';
  reasons: string[];
}

export const ExperimentCalculator = {
  hasSufficientVolume(sampleSize: number, minSampleRule: number): boolean {
    return sampleSize >= minSampleRule;
  },
  lift(controlRate: number, variantRate: number): number | undefined {
    return controlRate > 0 ? Math.round(((variantRate - controlRate) / controlRate) * 1000) / 10 : undefined;
  },
  /** A conservative two-proportion z-test approximation — good enough to gate "is this noise?", not a full stats package. */
  isStatisticallySignificant(controlConversions: number, controlN: number, variantConversions: number, variantN: number): boolean {
    if (controlN <= 0 || variantN <= 0) return false;
    const p1 = controlConversions / controlN;
    const p2 = variantConversions / variantN;
    const pooled = (controlConversions + variantConversions) / (controlN + variantN);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / controlN + 1 / variantN));
    if (se === 0) return false;
    const z = Math.abs(p2 - p1) / se;
    return z >= 1.96; // ~95% confidence
  },
  evaluate(input: {
    controlConversions: number;
    controlN: number;
    variantConversions: number;
    variantN: number;
    minSampleRule: number;
    practicalLiftThresholdPercent: number;
    guardrailBreached: boolean;
  }): ExperimentReadout {
    const reasons: string[] = [];
    const totalN = input.controlN + input.variantN;
    if (!ExperimentCalculator.hasSufficientVolume(totalN, input.minSampleRule)) {
      reasons.push('below minimum sample rule');
      return { liftPercent: undefined, statisticallySignificant: false, practicallyMeaningful: false, decision: 'inconclusive', reasons };
    }
    const controlRate = input.controlConversions / input.controlN;
    const variantRate = input.variantConversions / input.variantN;
    const liftPercent = ExperimentCalculator.lift(controlRate, variantRate);
    const significant = ExperimentCalculator.isStatisticallySignificant(
      input.controlConversions,
      input.controlN,
      input.variantConversions,
      input.variantN
    );
    const meaningful = liftPercent !== undefined && Math.abs(liftPercent) >= input.practicalLiftThresholdPercent;
    if (input.guardrailBreached) {
      reasons.push('guardrail metric breached');
      return { liftPercent, statisticallySignificant: significant, practicallyMeaningful: meaningful, decision: 'loser', reasons };
    }
    if (!significant || !meaningful) {
      reasons.push(!significant ? 'not statistically significant' : 'lift below practical threshold');
      return { liftPercent, statisticallySignificant: significant, practicallyMeaningful: meaningful, decision: 'inconclusive', reasons };
    }
    reasons.push(liftPercent! > 0 ? 'significant positive lift' : 'significant negative lift');
    return {
      liftPercent,
      statisticallySignificant: significant,
      practicallyMeaningful: meaningful,
      decision: liftPercent! > 0 ? 'winner' : 'loser',
      reasons,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// CreativeMetricsCalculator — spec §72, only from observed platform fields
// ---------------------------------------------------------------------------------------------

export const CreativeMetricsCalculator = {
  ctr(clicks?: number, impressions?: number): number | undefined {
    const v = safeDivide(clicks, impressions);
    return v !== undefined ? Math.round(v * 10000) / 100 : undefined;
  },
  cvr(conversions?: number, clicks?: number): number | undefined {
    const v = safeDivide(conversions, clicks);
    return v !== undefined ? Math.round(v * 10000) / 100 : undefined;
  },
  hookRate(threeSecondViews?: number, impressions?: number): number | undefined {
    const v = safeDivide(threeSecondViews, impressions);
    return v !== undefined ? Math.round(v * 10000) / 100 : undefined;
  },
  holdRate(thruplays?: number, threeSecondViews?: number): number | undefined {
    const v = safeDivide(thruplays, threeSecondViews);
    return v !== undefined ? Math.round(v * 10000) / 100 : undefined;
  },
  /** spec §73 — fatigue needs *joint* movement of frequency and CTR/CVR, never a single signal. */
  fatigueSignal(frequencyTrend: 'rising' | 'flat' | 'falling', ctrTrend: 'rising' | 'flat' | 'falling'): 'none' | 'watch' | 'confirmed' {
    if (frequencyTrend === 'rising' && ctrTrend === 'falling') return 'confirmed';
    if (frequencyTrend === 'rising' || ctrTrend === 'falling') return 'watch';
    return 'none';
  },
};

// ---------------------------------------------------------------------------------------------
// ConfidenceEngine — spec §9/§43, deterministic classification from evidence, not model self-rating
// ---------------------------------------------------------------------------------------------

const SOURCE_PRIORITY: Record<EvidenceSourceType, number> = {
  connector: 4,
  user: 4,
  project: 3,
  website: 2,
  web: 2,
  model: 1,
};

export const ConfidenceEngine = {
  classify(evidence: Evidence[]): ConfidenceLevel {
    if (evidence.length === 0) return 'low';
    const hasConflict = evidence.some((e) => e.conflictsWith && e.conflictsWith.length > 0);
    const maxPriority = Math.max(...evidence.map((e) => SOURCE_PRIORITY[e.sourceType]));
    const agreeingHighPriority = evidence.filter((e) => SOURCE_PRIORITY[e.sourceType] >= 3).length;
    if (hasConflict) return 'low';
    if (agreeingHighPriority >= 2 || (maxPriority === 4 && evidence.length >= 1 && agreeingHighPriority >= 1)) return 'high';
    if (maxPriority >= 2) return 'medium';
    return 'low';
  },
};

// ---------------------------------------------------------------------------------------------
// GuardrailEngine — Part K §69-70, the only thing allowed to say "yes you can scale/pause"
// ---------------------------------------------------------------------------------------------

export type BudgetActionType = 'pause_ad_set' | 'change_campaign_budget' | 'create_new_ad_set' | 'update_ad_set_targeting';

export interface BudgetActionRequest {
  type: BudgetActionType;
  currentStatus: 'active' | 'paused' | 'learning' | 'unknown';
  budgetType: 'campaign' | 'ad_set' | 'unknown';
  learningState: 'learning' | 'active' | 'limited' | 'unknown';
  deliveryConfirmed: boolean;
}

export interface GuardrailResult {
  allowed: boolean;
  reasons: string[];
}

export const GuardrailEngine = {
  /** spec §69 — reject actions that don't map to a real platform lever, or whose current setup wasn't verified. */
  evaluateBudgetAction(request: BudgetActionRequest): GuardrailResult {
    const reasons: string[] = [];
    if (!request.deliveryConfirmed) reasons.push('current delivery/config not verified against a fresh snapshot');
    if (request.budgetType === 'unknown') reasons.push('budget level (campaign vs ad set) unknown — cannot target a real lever');
    if (request.currentStatus === 'unknown') reasons.push('current status unknown');
    return { allowed: reasons.length === 0, reasons };
  },
  /** spec §70 SCALE CANDIDATE gate. */
  evaluateScaleGate(input: {
    reachedTargetKpi: boolean;
    meaningfulContribution: boolean;
    headroomStatus: HeadroomStatusLike;
    dominatedByWarmAudience: boolean;
    hasDeteriorationRiskNote: boolean;
    hasReviewWindow: boolean;
    hasSpendCap: boolean;
  }): GuardrailResult {
    const reasons: string[] = [];
    if (!input.reachedTargetKpi) reasons.push('target KPI not reached yet');
    if (!input.meaningfulContribution) reasons.push('contribution to results not meaningful yet');
    if (input.headroomStatus === 'saturated') reasons.push('channel/audience is saturated — no headroom to scale into');
    if (input.headroomStatus === 'unknown') reasons.push('headroom status unknown');
    if (input.dominatedByWarmAudience) reasons.push('result is dominated by a warm/existing-customer pocket');
    if (!input.hasDeteriorationRiskNote) reasons.push('missing deterioration-risk note');
    if (!input.hasReviewWindow) reasons.push('missing review window');
    if (!input.hasSpendCap) reasons.push('missing spend cap');
    return { allowed: reasons.length === 0, reasons };
  },
  /** spec §70 PAUSE CANDIDATE gate. */
  evaluatePauseGate(input: {
    sufficientSpendOrVolume: boolean;
    outOfLearningPhase: boolean;
    isPrimaryConversionSource: boolean;
    confirmedByMultipleSignals: boolean;
  }): GuardrailResult {
    const reasons: string[] = [];
    if (!input.sufficientSpendOrVolume) reasons.push('not enough spend/volume to judge yet');
    if (!input.outOfLearningPhase) reasons.push('still in learning phase / noise floor');
    if (input.isPrimaryConversionSource) reasons.push('this is a primary source of conversions — pausing carries outsized risk');
    if (!input.confirmedByMultipleSignals) reasons.push('the problem is only confirmed by a single signal');
    return { allowed: reasons.length === 0, reasons };
  },
};

type HeadroomStatusLike = 'unknown' | 'has_headroom' | 'at_headroom' | 'saturated';
