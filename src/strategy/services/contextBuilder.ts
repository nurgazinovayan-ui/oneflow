// Context Builder — spec §83. Packages only the minimal, task-relevant slice of the strategy for
// a single OpenAI call, never the whole project. Every field name here matches a field the
// server-side task instructions in supabase/functions/marketing-ai/index.ts (and its Electron
// mirror) expect in the request body.

import type { MarketingAITask } from '../../types';
import type { ChannelHypothesis, Evidence, Experiment, OfferHypothesis, Segment, StrategyV4 } from '../domain/types';

export interface StrategyContextInput {
  strategy: StrategyV4;
  briefText?: string;
  focusSegmentIds?: string[];
  focusOfferIds?: string[];
  focusChannelIds?: string[];
  focusExperimentId?: string;
  imageUrl?: string;
  metricsSnapshot?: Record<string, unknown>;
  extraPolicyHints?: string[];
}

const BASE_POLICY_HINTS = [
  'Не выдумывай факты, которых нет в переданном контексте.',
  'Разделяй факт / исследование / гипотезу / неизвестное.',
  'Численные метрики эффективности не считай сам — их вернёт детерминированный код ONEFLOW.',
];

function pickByIds<T extends { id: string }>(items: T[], ids?: string[]): T[] {
  if (!ids || ids.length === 0) return items;
  return items.filter((item) => ids.includes(item.id));
}

function goalSnapshot(strategy: StrategyV4) {
  return {
    objective: strategy.objective,
    market: strategy.market,
    budget: strategy.budget,
    currency: strategy.currency,
    periodMonths: strategy.periodMonths,
    locale: strategy.locale,
  };
}

function trimEvidence(evidence: Evidence[]): Evidence[] {
  // Evidence can grow large over a strategy's lifetime — send the most recent slice only; a task
  // that needs older evidence references it by id via evidenceIds on the entities it already has.
  return evidence.slice(-40);
}

function segmentSummary(segments: Segment[]) {
  return segments.map((s) => ({ id: s.id, name: s.name, buyingSituation: s.buyingSituation, priority: s.priority }));
}

function offerSummary(offers: OfferHypothesis[]) {
  return offers.map((o) => ({ id: o.id, promise: o.promise, motive: o.motive, status: o.status }));
}

function channelSummary(channels: ChannelHypothesis[]) {
  return channels.map((c) => ({ id: c.id, channel: c.channel, role: c.role }));
}

/** Builds the exact `context` object sent as the `marketingAI(task, context)` request body. */
export function buildContext(task: MarketingAITask, input: StrategyContextInput): Record<string, unknown> {
  const { strategy } = input;
  const base = {
    goalSnapshot: goalSnapshot(strategy),
    policyHints: [...BASE_POLICY_HINTS, ...(input.extraPolicyHints ?? [])],
    requestedOutputSchemaVersion: '4.0.0',
  };

  switch (task) {
    case 'understandBusiness':
      return { ...base, briefText: input.briefText, evidence: trimEvidence(strategy.evidence) };

    case 'analyzeSegments':
      return { ...base, businessSnapshot: strategy.businessUnderstanding, evidence: trimEvidence(strategy.evidence) };

    case 'analyzeJTBD':
      return {
        ...base,
        businessSnapshot: strategy.businessUnderstanding,
        relevantSegments: segmentSummary(pickByIds(strategy.segments, input.focusSegmentIds)),
        evidence: trimEvidence(strategy.evidence),
      };

    case 'proposePositioning':
      return {
        ...base,
        businessSnapshot: strategy.businessUnderstanding,
        relevantSegments: segmentSummary(pickByIds(strategy.segments, input.focusSegmentIds)),
        evidence: trimEvidence(strategy.evidence),
      };

    case 'proposeOffers':
      return {
        ...base,
        businessSnapshot: strategy.businessUnderstanding,
        relevantSegments: segmentSummary(pickByIds(strategy.segments, input.focusSegmentIds)),
        evidence: trimEvidence(strategy.evidence),
      };

    case 'analyzeChannels':
      return {
        ...base,
        relevantSegments: segmentSummary(pickByIds(strategy.segments, input.focusSegmentIds)),
        relevantOffers: offerSummary(pickByIds(strategy.offers, input.focusOfferIds)),
        evidence: trimEvidence(strategy.evidence),
      };

    case 'proposeCreativeStrategy':
      return {
        ...base,
        relevantOffers: offerSummary(pickByIds(strategy.offers, input.focusOfferIds)),
        relevantSegments: segmentSummary(pickByIds(strategy.segments, input.focusSegmentIds)),
        imageUrl: input.imageUrl,
        evidence: trimEvidence(strategy.evidence),
      };

    case 'designExperiments':
      return {
        ...base,
        relevantSegments: segmentSummary(pickByIds(strategy.segments, input.focusSegmentIds)),
        relevantChannels: channelSummary(pickByIds(strategy.channels, input.focusChannelIds)),
      };

    case 'interpretResults': {
      const experiment: Experiment | undefined = strategy.experiments.find((e) => e.id === input.focusExperimentId);
      return {
        ...base,
        metricsSnapshot: input.metricsSnapshot,
        experimentHistory: experiment ? [experiment] : [],
      };
    }

    case 'explainRecommendation':
      return { ...base, metricsSnapshot: input.metricsSnapshot };

    default:
      return base;
  }
}
