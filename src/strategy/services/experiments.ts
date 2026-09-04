import { genId } from '../domain/ids';
import type { Experiment, StrategyV4 } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, resolveId, str, strArr } from './normalize';

/** spec §23-24 Experiment Plan — one variable at a time, primary metric fixed before launch. */
export async function runDesignExperiments(strategy: StrategyV4, input: StrategyContextInput, mock = false): Promise<Experiment[]> {
  const context = buildContext('designExperiments', input);
  const raw = asRecord(await callMarketingAI('designExperiments', context, mock));
  const knownSegmentIds = strategy.segments.map((s) => s.id);
  return arrOf(raw.experiments, (item) => {
    const e = asRecord(item);
    const experiment: Experiment = {
      id: genId('exp'),
      hypothesisId: str(e.hypothesisId),
      name: str(e.name, 'Эксперимент'),
      audienceId: knownSegmentIds.length ? resolveId(e.audienceId, knownSegmentIds) : undefined,
      variants: strArr(e.variants).map((label) => ({ id: genId('var'), label, description: '' })),
      primaryMetric: str(e.primaryMetric),
      secondaryMetrics: [],
      guardrailMetrics: strArr(e.guardrailMetrics),
      status: 'planned',
      minDataRule: str(e.minDataRule) || undefined,
      durationRule: str(e.durationRule) || undefined,
      decisionRule: str(e.decisionRule) || undefined,
    };
    // Prepend the control as the first "variant" so the UI always has something to compare against.
    const control = str(e.control);
    if (control) experiment.variants.unshift({ id: genId('var'), label: control, description: 'control' });
    return experiment;
  });
}
