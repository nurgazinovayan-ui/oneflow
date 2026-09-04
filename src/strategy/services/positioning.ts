import { genId } from '../domain/ids';
import type { PositioningOption, PositioningStyle, StrategyV4 } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, bool, oneOf, resolveId, str, strArr } from './normalize';

const STYLES: PositioningStyle[] = ['rational', 'outcome', 'technological'];

/** spec §15 Positioning — 2-3 directions, exactly one recommended (never declared a "winner"). */
export async function runProposePositioning(
  strategy: StrategyV4,
  input: StrategyContextInput,
  mock = false
): Promise<PositioningOption[]> {
  const context = buildContext('proposePositioning', input);
  const raw = asRecord(await callMarketingAI('proposePositioning', context, mock));
  const knownSegmentIds = strategy.segments.map((s) => s.id);
  const options = arrOf(raw.directions, (item) => {
    const d = asRecord(item);
    const option: PositioningOption = {
      id: genId('pos'),
      segmentId: resolveId(d.segmentId, knownSegmentIds),
      alternative: str(d.alternative),
      value: str(d.value),
      reasonToBelieve: str(d.reasonToBelieve),
      proofNeeded: str(d.proofNeeded),
      style: oneOf(d.style, STYLES, 'outcome'),
      evidenceIds: strArr(d.evidenceIds),
      isPrimary: bool(d.recommended, false),
    };
    return option;
  });
  if (!options.some((o) => o.isPrimary) && options.length > 0) options[0].isPrimary = true;
  return options;
}
