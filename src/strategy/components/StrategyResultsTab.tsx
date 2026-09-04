import { useState } from 'react';
import { useT } from '../../i18n';
import type { StrategyV4 } from '../domain/types';
import { useStrategyStore } from '../state/strategyStore';
import { runInterpretResults } from '../services/learnings';
import { ConfidenceBadge } from './EvidenceBadge';
import { validateRecommendation } from '../domain/validation';

export default function StrategyResultsTab({ strategy }: { strategy: StrategyV4 }) {
  const t = useT();
  const updateStrategy = useStrategyStore((s) => s.updateStrategy);
  const pushHistory = useStrategyStore((s) => s.pushHistory);
  const [interpreting, setInterpreting] = useState<string | null>(null);

  const experimentsNeedingInterpretation = strategy.experiments.filter(
    (e) => e.result && !strategy.learnings.some((l) => l.experimentId === e.id)
  );

  const handleInterpret = async (experimentId: string) => {
    setInterpreting(experimentId);
    try {
      const experiment = strategy.experiments.find((e) => e.id === experimentId);
      const { learning, proposal } = await runInterpretResults(
        { strategy, focusExperimentId: experimentId, metricsSnapshot: experiment?.result as unknown as Record<string, unknown> },
        false
      );
      const finalLearning = { ...learning, experimentId };
      updateStrategy((s) => ({
        ...s,
        learnings: [...s.learnings, finalLearning],
        proposals: [...s.proposals, proposal],
        experiments: s.experiments.map((e) => (e.id === experimentId ? { ...e, learningId: finalLearning.id } : e)),
      }));
    } finally {
      setInterpreting(null);
    }
  };

  const handleApply = (proposalId: string) => {
    const proposal = strategy.proposals.find((p) => p.id === proposalId);
    updateStrategy((s) => ({
      ...s,
      proposals: s.proposals.map((p) => (p.id === proposalId ? { ...p, state: 'accepted' } : p)),
    }));
    pushHistory({
      type: 'ai_proposal_applied',
      description: proposal?.why ?? 'Предложение применено',
      proposalId,
    });
  };

  const handleReject = (proposalId: string) => {
    updateStrategy((s) => ({
      ...s,
      proposals: s.proposals.map((p) => (p.id === proposalId ? { ...p, state: 'rejected' } : p)),
    }));
    pushHistory({ type: 'ai_proposal_rejected', description: 'Предложение отклонено', proposalId });
  };

  const hasAnything = strategy.learnings.length > 0 || experimentsNeedingInterpretation.length > 0;

  return (
    <div className="strategy-results-tab">
      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.resultsLearningsTitle}</div>
        {!hasAnything && <div className="strategy-empty-note">{t.strategy.resultsEmpty}</div>}
        {experimentsNeedingInterpretation.map((e) => (
          <div key={e.id} className="results-pending-item">
            <span>{e.name}</span>
            <button type="button" className="strategy-inline-link" disabled={interpreting === e.id} onClick={() => handleInterpret(e.id)}>
              {interpreting === e.id ? '…' : 'Интерпретировать →'}
            </button>
          </div>
        ))}
        {strategy.learnings.map((l) => (
          <div key={l.id} className="results-learning-item">
            <div className="analysis-item-header">
              <ConfidenceBadge level={l.confidence} />
              <span className="analysis-status-tag">{l.strength}</span>
            </div>
            <div>{l.whatHappened}</div>
            {l.likelyDrivers.length > 0 && <div className="analysis-item-sub">Причины: {l.likelyDrivers.join('; ')}</div>}
            {l.unsupportedExplanations.length > 0 && (
              <div className="analysis-item-sub results-unsupported">Не подтверждено: {l.unsupportedExplanations.join('; ')}</div>
            )}
          </div>
        ))}
      </div>

      {strategy.proposals.length > 0 && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title">{t.strategy.resultsProposalsTitle}</div>
          {strategy.proposals.map((p) => (
            <div key={p.id} className={`results-proposal-item state-${p.state}`}>
              <div className="results-proposal-changes">
                {p.changes.map((c, i) => (
                  <div key={i} className="results-proposal-change">
                    <span className="results-proposal-field">{c.field}</span>: <s>{c.before}</s> → <strong>{c.after}</strong>
                  </div>
                ))}
              </div>
              <div className="analysis-item-sub">
                {t.strategy.proposalWhyLabel}: {p.why}
              </div>
              <div className="validation-pipeline-row">
                {validateRecommendation(strategy, p, strategy.landingAudit).map((check, i) => (
                  <span key={i} className={`validation-dot validation-${check.status}`} title={`${check.label}: ${check.detail}`} />
                ))}
              </div>
              {p.state === 'proposed' && (
                <div className="results-proposal-actions">
                  <button type="button" className="generate-btn" onClick={() => handleApply(p.id)}>
                    {t.strategy.proposalApplyBtn}
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => handleReject(p.id)}>
                    {t.strategy.proposalRejectBtn}
                  </button>
                </div>
              )}
              {p.state === 'accepted' && <div className="results-proposal-state">{t.strategy.proposalAppliedLabel}</div>}
              {p.state === 'rejected' && <div className="results-proposal-state">{t.strategy.proposalRejectedLabel}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
