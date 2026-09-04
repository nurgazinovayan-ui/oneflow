import { genId } from '../domain/ids';
import type { CreativeArchetype, CreativeCard, CreativeIntentStage, CreativeVisualFormat, StrategyV4 } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, oneOf, resolveId, str, strArr } from './normalize';

const ARCHETYPES: CreativeArchetype[] = [
  'problem_solution',
  'demo',
  'before_after',
  'ugc_testimonial',
  'comparison',
  'objection_handling',
  'offer_led',
  'proof_case',
];
const FORMATS: CreativeVisualFormat[] = [
  'ugc',
  'studio',
  'product',
  'lifestyle',
  'demo',
  'text_graphic',
  'animation',
  'catalog',
  'not_observable',
];
const STAGES: CreativeIntentStage[] = ['prospecting', 'consideration', 'conversion'];

/** spec §20/§71 Creative Strategy — content-layer creative hypotheses; performance/learning fill in once real data flows. */
export async function runProposeCreativeStrategy(
  strategy: StrategyV4,
  input: StrategyContextInput,
  mock = false
): Promise<CreativeCard[]> {
  const context = buildContext('proposeCreativeStrategy', input);
  const raw = asRecord(await callMarketingAI('proposeCreativeStrategy', context, mock));
  const knownOfferIds = strategy.offers.map((o) => o.id);
  return arrOf(raw.concepts, (item) => {
    const c = asRecord(item);
    const card: CreativeCard = {
      id: genId('cre'),
      archetype: oneOf(c.archetype, ARCHETYPES, 'demo'),
      content: {
        hook: str(c.hook),
        visualFormat: oneOf(c.visualFormat, FORMATS, 'not_observable'),
        messagingTheme: str(c.messagingTheme),
        offerId: knownOfferIds.includes(String(c.offerId)) ? String(c.offerId) : undefined,
        cta: str(c.cta),
        persona: str(c.persona, 'not_observable'),
        intentStage: oneOf(c.intentStage, STAGES, 'prospecting'),
        reuseLongevity: undefined,
      },
      performance: {
        fatigueSignal: 'none',
        notObservable: ['spend', 'ctr', 'cpa', 'cvr', 'frequency', 'hookRate', 'holdRate'],
      },
      learning: {},
      strategyLinks: {
        offerId: knownOfferIds.includes(String(c.offerId)) ? String(c.offerId) : undefined,
      },
      status: 'planned',
      evidenceIds: strArr(c.evidenceIds),
    };
    return card;
  });
}

export function resolveOfferReference(strategy: StrategyV4, claimedOfferId: unknown): string | undefined {
  const knownOfferIds = strategy.offers.map((o) => o.id);
  return resolveId(claimedOfferId, knownOfferIds) || undefined;
}
