import { genId } from '../domain/ids';
import type { JTBD, Segment, SegmentPriority, StrategyV4 } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, oneOf, resolveId, str, strArr } from './normalize';

const PRIORITIES: SegmentPriority[] = ['now', 'test', 'later'];
const CONFIDENCE = ['high', 'medium', 'low'] as const;

/** spec §12 Segmentation + ICP. */
export async function runAnalyzeSegments(input: StrategyContextInput, mock = false): Promise<Segment[]> {
  const context = buildContext('analyzeSegments', input);
  const raw = asRecord(await callMarketingAI('analyzeSegments', context, mock));
  return arrOf(raw.segments, (item) => {
    const s = asRecord(item);
    const segment: Segment = {
      id: genId('seg'),
      name: str(s.name, 'Сегмент'),
      buyingSituation: str(s.buyingSituation),
      needFrequency: str(s.needFrequency),
      abilityToPay: str(s.abilityToPay),
      accessibility: str(s.accessibility),
      urgencyTrigger: str(s.urgencyTrigger),
      productFit: str(s.productFit),
      priority: oneOf(s.priority, PRIORITIES, 'test'),
      priorityRationale: str(s.priorityRationale),
      evidenceIds: strArr(s.evidenceIds),
      confidence: oneOf(s.confidence, CONFIDENCE, 'low'),
      assumptions: strArr(s.assumptions),
    };
    return segment;
  });
}

/** spec §13 JTBD — needs strategy.segments to already carry real ids (run after runAnalyzeSegments). */
export async function runAnalyzeJTBD(strategy: StrategyV4, input: StrategyContextInput, mock = false): Promise<JTBD[]> {
  const context = buildContext('analyzeJTBD', input);
  const raw = asRecord(await callMarketingAI('analyzeJTBD', context, mock));
  const knownSegmentIds = strategy.segments.map((s) => s.id);
  return arrOf(raw.jtbd, (item) => {
    const j = asRecord(item);
    const entry: JTBD = {
      id: genId('jtbd'),
      segmentId: resolveId(j.segmentId, knownSegmentIds),
      situation: str(j.situation),
      motivation: str(j.motivation),
      desiredOutcome: str(j.desiredOutcome),
      alternativesToday: str(j.alternativesToday),
      anxieties: str(j.anxieties),
      evidenceIds: strArr(j.evidenceIds),
    };
    return entry;
  });
}
