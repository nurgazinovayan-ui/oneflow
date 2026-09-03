import { IconClose } from './Icons';
import type { StrategyBrief, StrategyData } from '../strategyTypes';
import { buildScenarios, type ScenarioId } from '../strategyCompute';
import { useT, type Translations } from '../i18n';

interface StrategyScenarioModalProps {
  data: StrategyData;
  brief: StrategyBrief;
  onClose: () => void;
}

function scenarioLabel(t: Translations, id: ScenarioId): string {
  switch (id) {
    case 'main':
      return t.strategy.scenarioMain;
    case 'aggressive':
      return t.strategy.scenarioAggressive;
    case 'lean':
      return t.strategy.scenarioLean;
  }
}

// Spec §19/UI42 — a read-only comparison grid. Deliberately not a full scenario-switching mode
// (spec UI41's "New Scenario"/persisted custom scenarios): there's no backend to persist a
// second strategy version, and switching the whole Overview to a different scenario's numbers
// would need every card to carry scenario-aware state. This shows the same clean comparison the
// spec's own mockup does, computed live from strategyCompute.buildScenarios, clearly labeled as
// an estimate rather than a real forecast.
export default function StrategyScenarioModal({ data, brief, onClose }: StrategyScenarioModalProps) {
  const t = useT();
  const scenarios = buildScenarios(data, brief);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal strategy-scenario-modal" onClick={(e) => e.stopPropagation()}>
        <div className="strategy-drawer-header">
          <span>{t.strategy.scenarioCompareTitle}</span>
          <button className="evaluation-slot-remove" onClick={onClose}>
            <IconClose size={14} />
          </button>
        </div>
        <div className="strategy-scenario-grid">
          <div className="strategy-scenario-row strategy-scenario-header-row">
            <div className="strategy-scenario-cell strategy-scenario-label-cell" />
            {scenarios.map((s) => (
              <div key={s.id} className="strategy-scenario-cell strategy-scenario-header-cell">
                {scenarioLabel(t, s.id)}
              </div>
            ))}
          </div>
          <div className="strategy-scenario-row">
            <div className="strategy-scenario-cell strategy-scenario-label-cell">{t.strategy.scenarioBudget}</div>
            {scenarios.map((s) => (
              <div key={s.id} className="strategy-scenario-cell">
                {s.budget.toLocaleString('ru-RU')} {brief.currency}
              </div>
            ))}
          </div>
          <div className="strategy-scenario-row">
            <div className="strategy-scenario-cell strategy-scenario-label-cell">{t.strategy.scenarioGrowth}</div>
            {scenarios.map((s) => (
              <div key={s.id} className="strategy-scenario-cell">
                {s.growthPercent > 0 ? `+${s.growthPercent}%` : `${s.growthPercent}%`}
              </div>
            ))}
          </div>
          <div className="strategy-scenario-row">
            <div className="strategy-scenario-cell strategy-scenario-label-cell">{t.strategy.scenarioCac}</div>
            {scenarios.map((s) => (
              <div key={s.id} className="strategy-scenario-cell">
                {s.cac !== null ? `${s.cac.toLocaleString('ru-RU')} ${brief.currency}` : t.strategy.forecastInsufficientData}
              </div>
            ))}
          </div>
          <div className="strategy-scenario-row">
            <div className="strategy-scenario-cell strategy-scenario-label-cell">{t.strategy.scenarioRisk}</div>
            {scenarios.map((s) => (
              <div key={s.id} className={`strategy-scenario-cell strategy-scenario-risk-${s.risk.toLowerCase()}`}>
                {s.risk === 'Low' ? t.strategy.riskLow : s.risk === 'Medium' ? t.strategy.riskMedium : t.strategy.riskHigh}
              </div>
            ))}
          </div>
        </div>
        <div className="strategy-scenario-disclaimer">{t.strategy.scenarioDisclaimer}</div>
      </div>
    </div>
  );
}
