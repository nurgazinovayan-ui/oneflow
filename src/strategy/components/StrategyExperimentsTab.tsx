import { useState } from 'react';
import { useT } from '../../i18n';
import type { Experiment, StrategyV4 } from '../domain/types';
import { useStrategyStore } from '../state/strategyStore';
import { runDesignExperiments } from '../services/experiments';
import { ExperimentCalculator } from '../domain/calculators';

const STATUS_KEY: Record<Experiment['status'], keyof ReturnType<typeof useT>['strategy']> = {
  planned: 'experimentStatusPlanned',
  running: 'experimentStatusRunning',
  completed: 'experimentStatusCompleted',
  stopped: 'experimentStatusStopped',
};

function ResultForm({ experiment, onSubmit }: { experiment: Experiment; onSubmit: (result: Experiment['result']) => void }) {
  const t = useT();
  const [controlN, setControlN] = useState(0);
  const [controlConv, setControlConv] = useState(0);
  const [variantN, setVariantN] = useState(0);
  const [variantConv, setVariantConv] = useState(0);
  const [guardrailBreached, setGuardrailBreached] = useState(false);

  const submit = () => {
    const readout = ExperimentCalculator.evaluate({
      controlConversions: controlConv,
      controlN,
      variantConversions: variantConv,
      variantN,
      minSampleRule: 200,
      practicalLiftThresholdPercent: 5,
      guardrailBreached,
    });
    onSubmit({ decision: readout.decision === 'inconclusive' ? 'inconclusive' : readout.decision, summary: readout.reasons.join('; ') });
  };

  return (
    <div className="experiment-result-form">
      <div className="experiment-result-row">
        <label>
          {t.strategy.experimentControlLabel} — {t.strategy.experimentVolumeLabel}
          <input type="number" min={0} value={controlN} onChange={(e) => setControlN(Number(e.target.value) || 0)} />
        </label>
        <label>
          {t.strategy.experimentConversionsLabel}
          <input type="number" min={0} value={controlConv} onChange={(e) => setControlConv(Number(e.target.value) || 0)} />
        </label>
      </div>
      <div className="experiment-result-row">
        <label>
          {t.strategy.experimentVariantLabel} — {t.strategy.experimentVolumeLabel}
          <input type="number" min={0} value={variantN} onChange={(e) => setVariantN(Number(e.target.value) || 0)} />
        </label>
        <label>
          {t.strategy.experimentConversionsLabel}
          <input type="number" min={0} value={variantConv} onChange={(e) => setVariantConv(Number(e.target.value) || 0)} />
        </label>
      </div>
      <label className="experiment-guardrail-check">
        <input type="checkbox" checked={guardrailBreached} onChange={(e) => setGuardrailBreached(e.target.checked)} />
        Guardrail metric breached
      </label>
      <button type="button" className="generate-btn" onClick={submit}>
        {t.strategy.experimentSubmitResultBtn}
      </button>
    </div>
  );
}

export default function StrategyExperimentsTab({ strategy }: { strategy: StrategyV4 }) {
  const t = useT();
  const updateStrategy = useStrategyStore((s) => s.updateStrategy);
  const pushHistory = useStrategyStore((s) => s.pushHistory);
  const [designing, setDesigning] = useState(false);
  const [enteringResultFor, setEnteringResultFor] = useState<string | null>(null);

  const handleDesign = async () => {
    setDesigning(true);
    try {
      const primaryOffer = strategy.offers.find((o) => o.isPrimary) ?? strategy.offers[0];
      const newExperiments = await runDesignExperiments(
        strategy,
        { strategy, focusOfferIds: primaryOffer ? [primaryOffer.id] : undefined },
        false
      );
      updateStrategy((s) => ({ ...s, experiments: [...s.experiments, ...newExperiments] }));
    } finally {
      setDesigning(false);
    }
  };

  const handleResult = (experiment: Experiment, result: Experiment['result']) => {
    updateStrategy((s) => ({
      ...s,
      experiments: s.experiments.map((e) => (e.id === experiment.id ? { ...e, status: 'completed', result } : e)),
    }));
    pushHistory({
      type: 'manual_edit',
      description: `Результат эксперимента "${experiment.name}": ${result?.decision}`,
      rationale: result?.summary,
    });
    setEnteringResultFor(null);
  };

  return (
    <div className="strategy-experiments-tab">
      <div className="strategy-card-title-row">
        <div className="strategy-card-title">{t.strategy.experimentsTitle}</div>
        <button type="button" className="secondary-btn" onClick={handleDesign} disabled={designing}>
          {t.strategy.experimentDesignBtn}
        </button>
      </div>

      {strategy.experiments.length === 0 && <div className="strategy-empty-note">{t.strategy.experimentsEmpty}</div>}

      <div className="experiments-list">
        {strategy.experiments.map((e) => (
          <div key={e.id} className="strategy-card plan-card experiment-card">
            <div className="analysis-item-header">
              <span className="analysis-table-name">{e.name}</span>
              <span className="analysis-status-tag">{t.strategy[STATUS_KEY[e.status]]}</span>
            </div>
            <div className="analysis-item-sub">metric: {e.primaryMetric}</div>
            <div className="analysis-item-sub">variants: {e.variants.map((v) => v.label).join(' vs ')}</div>
            {e.result && (
              <div className={`experiment-decision experiment-decision-${e.result.decision}`}>
                {e.result.decision === 'winner'
                  ? t.strategy.experimentDecisionWinner
                  : e.result.decision === 'loser'
                    ? t.strategy.experimentDecisionLoser
                    : t.strategy.experimentDecisionInconclusive}
                <span className="analysis-item-sub"> — {e.result.summary}</span>
              </div>
            )}
            {!e.result && enteringResultFor !== e.id && (
              <button type="button" className="strategy-inline-link" onClick={() => setEnteringResultFor(e.id)}>
                {t.strategy.experimentEnterResultBtn}
              </button>
            )}
            {!e.result && enteringResultFor === e.id && (
              <ResultForm experiment={e} onSubmit={(result) => handleResult(e, result)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
