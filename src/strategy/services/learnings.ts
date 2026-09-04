import { genId } from '../domain/ids';
import type { ConfidenceLevel, Learning, StrategyUpdateProposal } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { arrOf, asRecord, bool, oneOf, str, strArr } from './normalize';

const CONFIDENCE: ConfidenceLevel[] = ['high', 'medium', 'low'];
const STRENGTH = ['strong', 'moderate', 'weak'] as const;

/** spec §25-26 Learning — interprets already-computed metrics; never mutates strategy directly. */
export async function runInterpretResults(input: StrategyContextInput, mock = false): Promise<{ learning: Learning; proposal: StrategyUpdateProposal }> {
  const context = buildContext('interpretResults', input);
  const raw = asRecord(await callMarketingAI('interpretResults', context, mock));
  const proposalRaw = asRecord(raw.strategyUpdateProposal);

  const proposal: StrategyUpdateProposal = {
    id: genId('prop'),
    changes: arrOf(proposalRaw.changes, (c) => {
      const change = asRecord(c);
      return { field: str(change.field), before: str(change.before), after: str(change.after) };
    }),
    why: str(proposalRaw.why),
    evidenceIds: strArr(proposalRaw.evidenceIds),
    affectedModules: strArr(proposalRaw.affectedModules),
    requiresUserApproval: bool(proposalRaw.requiresUserApproval, true),
    rollbackLabel: str(proposalRaw.rollbackLabel, 'Отменить изменение'),
    state: 'proposed',
    createdAt: Date.now(),
  };

  const learning: Learning = {
    id: genId('learn'),
    experimentId: input.focusExperimentId ?? '',
    whatHappened: str(raw.whatHappened),
    likelyDrivers: strArr(raw.likelyDrivers),
    unsupportedExplanations: strArr(raw.unsupportedExplanations),
    evidenceIds: strArr(raw.evidenceIds),
    confidence: oneOf(raw.confidence, CONFIDENCE, 'low'),
    strength: oneOf(raw.strength, STRENGTH, 'weak'),
    affectedStrategyPaths: strArr(raw.affectedStrategyPaths),
    strategyUpdateProposalId: proposal.id,
  };

  return { learning, proposal };
}

/** spec §99 — a short plain-language explanation layered over an already-structured result. */
export async function runExplainRecommendation(
  input: StrategyContextInput,
  mock = false
): Promise<{ whatWeSaw: string; whyItMatters: string; howConfirmed: string; whatToCheckNext: string; whatChangesOnApply: string }> {
  const context = buildContext('explainRecommendation', input);
  const raw = asRecord(await callMarketingAI('explainRecommendation', context, mock));
  return {
    whatWeSaw: str(raw.whatWeSaw),
    whyItMatters: str(raw.whyItMatters),
    howConfirmed: str(raw.howConfirmed),
    whatToCheckNext: str(raw.whatToCheckNext),
    whatChangesOnApply: str(raw.whatChangesOnApply),
  };
}
