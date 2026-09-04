// Orchestrates the multi-step analysis pipeline — spec §5/§84. Each stage saves a structured
// result and hands only that result forward; nothing here re-sends the whole strategy back to
// OpenAI on every step (see contextBuilder.ts for what actually gets sent).

import { buildActionPlan } from '../domain/actionPlan';
import { createEmptyStrategy, type NewStrategyInput } from '../domain/factory';
import { computeReadiness } from '../domain/readiness';
import type { StrategyV4 } from '../domain/types';
import { runUnderstandBusiness } from './businessUnderstanding';
import { runAnalyzeChannels } from './channels';
import { runProposeCreativeStrategy } from './creativeStrategy';
import { runAnalyzeJTBD, runAnalyzeSegments } from './segmentation';
import { runProposeOffers } from './offers';
import { runProposePositioning } from './positioning';

export type PipelineStage = 'understandBusiness' | 'segments' | 'jtbd' | 'positioning' | 'offers' | 'channels' | 'creative' | 'plan';

export const PIPELINE_STAGES: PipelineStage[] = [
  'understandBusiness',
  'segments',
  'jtbd',
  'positioning',
  'offers',
  'channels',
  'creative',
  'plan',
];

/** spec §6 — the mandatory first step, run before anything else and shown to the user for confirmation. */
export async function runBusinessUnderstandingStage(briefText: string, input: NewStrategyInput, mock: boolean): Promise<StrategyV4> {
  const strategy = createEmptyStrategy(input);
  const businessUnderstanding = await runUnderstandBusiness({ strategy, briefText }, mock);
  return { ...strategy, businessUnderstanding };
}

/** Runs Segmentation → JTBD → Positioning → Offers → Channels → Creative → Action Plan, in order, once the user has confirmed Business Understanding. */
export async function runFullPipeline(
  strategy: StrategyV4,
  mock: boolean,
  onStage?: (stage: PipelineStage) => void
): Promise<StrategyV4> {
  let s = strategy;

  onStage?.('segments');
  s = { ...s, segments: await runAnalyzeSegments({ strategy: s }, mock) };

  onStage?.('jtbd');
  s = { ...s, jtbd: await runAnalyzeJTBD(s, { strategy: s }, mock) };

  onStage?.('positioning');
  s = { ...s, positioningOptions: await runProposePositioning(s, { strategy: s }, mock) };

  onStage?.('offers');
  s = { ...s, offers: await runProposeOffers(s, { strategy: s }, mock) };

  onStage?.('channels');
  s = { ...s, channels: await runAnalyzeChannels(s, { strategy: s }, mock) };

  onStage?.('creative');
  s = { ...s, creativeCards: await runProposeCreativeStrategy(s, { strategy: s }, mock) };

  onStage?.('plan');
  s = { ...s, actionPlan: buildActionPlan(s) };
  s = { ...s, readiness: computeReadiness(s), updatedAt: Date.now() };
  return s;
}
