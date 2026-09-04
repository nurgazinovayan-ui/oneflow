// Recommendation Validation Pipeline — spec §77. Nine checks run before a recommendation is
// shown/applied. This build surfaces them as an honest checklist next to the recommendation
// (not a hard block) — the real gate is the user's own Apply/Reject click (spec §98), and several
// checks are informational until the Evidence Store and connector layer are populated with real
// campaign data (out of this build's MVP scope, see spec §61 "can come later").

import type { LandingAudit, StrategyUpdateProposal, StrategyV4 } from './types';

export type ValidationCheckStatus = 'pass' | 'warn' | 'fail';

export interface ValidationCheck {
  label: string;
  status: ValidationCheckStatus;
  detail: string;
}

export function validateRecommendation(
  strategy: StrategyV4,
  proposal: StrategyUpdateProposal,
  landingAudit: LandingAudit | null
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  checks.push({
    label: 'Факт / исследование / гипотеза?',
    status: proposal.evidenceIds.length > 0 ? 'pass' : 'warn',
    detail: proposal.evidenceIds.length > 0 ? `${proposal.evidenceIds.length} evidence` : 'Нет привязанного evidence — гипотеза',
  });

  checks.push({
    label: 'Определение метрики валидно?',
    status: proposal.changes.every((c) => c.field && c.after) ? 'pass' : 'fail',
    detail: proposal.changes.map((c) => c.field).join(', ') || 'нет изменений',
  });

  const relatedExperiments = strategy.experiments.filter((e) =>
    strategy.learnings.some((l) => l.strategyUpdateProposalId === proposal.id && l.experimentId === e.id)
  );
  checks.push({
    label: 'Достаточно данных / выше noise floor?',
    status: relatedExperiments.some((e) => e.result && e.result.decision !== 'inconclusive') ? 'pass' : 'warn',
    detail: relatedExperiments.length > 0 ? relatedExperiments.map((e) => e.result?.decision ?? '—').join(', ') : 'нет связанного эксперимента',
  });

  checks.push({
    label: 'Соответствует реальному platform lever?',
    status: 'warn',
    detail: 'Требует проверки в рекламном кабинете перед выполнением',
  });

  checks.push({
    label: 'Budget headroom известен?',
    status: strategy.channels.some((c) => c.headroomStatus !== 'unknown') ? 'pass' : 'warn',
    detail: strategy.channels.map((c) => c.headroomStatus).join(', ') || 'нет данных',
  });

  checks.push({
    label: 'Сохраняет downstream quality?',
    status: 'warn',
    detail: 'Проверьте guardrail-метрики перед применением',
  });

  checks.push({
    label: 'Creative message совпадает с landing?',
    status: landingAudit ? (landingAudit.status === 'mismatch' ? 'fail' : landingAudit.status === 'partial' ? 'warn' : 'pass') : 'warn',
    detail: landingAudit ? landingAudit.status : 'Landing audit не проведён',
  });

  checks.push({
    label: 'Что опровергнет эту рекомендацию?',
    status: proposal.why ? 'pass' : 'fail',
    detail: proposal.why || 'нет обоснования',
  });

  checks.push({
    label: 'Review window / stop condition заданы?',
    status: proposal.requiresUserApproval ? 'pass' : 'warn',
    detail: proposal.requiresUserApproval ? 'Требуется подтверждение пользователя' : '—',
  });

  return checks;
}
