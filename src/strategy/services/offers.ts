import { genId } from '../domain/ids';
import type { EvidenceType, OfferHypothesis, OfferMotive, StrategyV4 } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, bool, oneOf, resolveId, str, strArr } from './normalize';

const MOTIVES: OfferMotive[] = ['speed', 'savings', 'simplicity', 'quality', 'volume', 'risk', 'growth'];
const EVIDENCE_TYPES: EvidenceType[] = ['fact', 'research', 'hypothesis', 'unknown'];
const CONFIDENCE = ['high', 'medium', 'low'] as const;

/** spec §16 Offer Strategy — offers are testable hypotheses, not final truths. */
export async function runProposeOffers(strategy: StrategyV4, input: StrategyContextInput, mock = false): Promise<OfferHypothesis[]> {
  const context = buildContext('proposeOffers', input);
  const raw = asRecord(await callMarketingAI('proposeOffers', context, mock));
  const knownSegmentIds = strategy.segments.map((s) => s.id);
  const offers = arrOf(raw.offers, (item) => {
    const o = asRecord(item);
    const offer: OfferHypothesis = {
      id: genId('offer'),
      segmentId: resolveId(o.segmentId, knownSegmentIds),
      motive: oneOf(o.motive, MOTIVES, 'growth'),
      promise: str(o.promise),
      mechanism: str(o.mechanism),
      proof: str(o.proof),
      objectionHandled: str(o.objectionHandled),
      cta: str(o.cta),
      evidenceType: oneOf(o.evidenceType, EVIDENCE_TYPES, 'hypothesis'),
      confidence: oneOf(o.confidence, CONFIDENCE, 'low'),
      status: 'untested',
      experimentNeeded: bool(o.experimentNeeded, true),
      isPrimary: bool(o.recommended, false),
    };
    return offer;
  });
  if (!offers.some((o) => o.isPrimary) && offers.length > 0) offers[0].isPrimary = true;
  return offers;
}

/** spec §16 "generate alternatives" — new offers appended alongside existing ones, none primary yet. */
export async function runProposeMoreOffers(
  strategy: StrategyV4,
  input: StrategyContextInput,
  mock = false
): Promise<OfferHypothesis[]> {
  const offers = await runProposeOffers(strategy, input, mock);
  return offers.map((o) => ({ ...o, isPrimary: false }));
}
