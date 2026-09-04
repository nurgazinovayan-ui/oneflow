import { genId } from '../domain/ids';
import type { ChannelFunnelStage, ChannelHypothesis, StrategyV4 } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, oneOf, resolveId, str, strArr } from './normalize';

const STAGES: ChannelFunnelStage[] = ['awareness', 'consideration', 'conversion'];
const CONFIDENCE = ['high', 'medium', 'low'] as const;

/** spec §18/§68-70 Channel Strategy — role/testability first, never a fabricated budget split. */
export async function runAnalyzeChannels(
  strategy: StrategyV4,
  input: StrategyContextInput,
  mock = false
): Promise<ChannelHypothesis[]> {
  const context = buildContext('analyzeChannels', input);
  const raw = asRecord(await callMarketingAI('analyzeChannels', context, mock));
  const knownSegmentIds = strategy.segments.map((s) => s.id);
  return arrOf(raw.channels, (item) => {
    const c = asRecord(item);
    const channel: ChannelHypothesis = {
      id: genId('chan'),
      channel: str(c.channel),
      role: str(c.role),
      targetSegmentId: resolveId(c.targetSegmentId, knownSegmentIds),
      funnelStage: oneOf(c.funnelStage, STAGES, 'awareness'),
      contentTypes: strArr(c.contentTypes),
      whyTest: str(c.whyTest),
      requiredData: strArr(c.requiredData),
      scaleCriteria: strArr(c.scaleCriteria),
      pauseCriteria: strArr(c.pauseCriteria),
      headroomStatus: 'unknown',
      evidenceIds: strArr(c.evidenceIds),
      confidence: oneOf(c.confidence, CONFIDENCE, 'low'),
    };
    return channel;
  });
}
