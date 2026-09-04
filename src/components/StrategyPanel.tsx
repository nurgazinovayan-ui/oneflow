import { useState } from 'react';
import StrategyOnboarding from './StrategyOnboarding';
import StrategySidebar, { type StrategyTab } from './StrategySidebar';
import { useT } from '../i18n';
import { useStrategyStore } from '../strategy/state/strategyStore';
import StrategyPlanTab from '../strategy/components/StrategyPlanTab';
import StrategyAnalysisTab from '../strategy/components/StrategyAnalysisTab';
import StrategyExperimentsTab from '../strategy/components/StrategyExperimentsTab';
import StrategyResultsTab from '../strategy/components/StrategyResultsTab';

interface StrategyPanelProps {
  active: boolean;
  onCreateWorkflow: (prompt: string) => void;
}

// Top-level "Стратегия" mode — v4, built against the ONEFLOW Marketing Intelligence Master Spec
// v4 (OpenAI Runtime). Mounted like every other main-view panel in App.tsx (always in the DOM,
// hidden via CSS when `active` is false). Onboarding owns the whole AI pipeline orchestration
// (src/strategy/services/pipeline.ts) and only commits a fully-assembled StrategyV4 to
// useStrategyStore — this component just decides onboarding vs. shell based on that store.
export default function StrategyPanel({ active, onCreateWorkflow: _onCreateWorkflow }: StrategyPanelProps) {
  const t = useT();
  const strategy = useStrategyStore((s) => s.strategy);
  const resetStrategy = useStrategyStore((s) => s.reset);
  const [tab, setTab] = useState<StrategyTab>('plan');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleReset = () => {
    resetStrategy();
    setTab('plan');
  };

  return (
    <div className={`strategy-panel ${active ? '' : 'strategy-hidden'}`}>
      {!strategy ? (
        <StrategyOnboarding />
      ) : (
        <div className="strategy-shell">
          <StrategySidebar
            tab={tab}
            onTabChange={setTab}
            onReset={handleReset}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
            readiness={strategy.readiness}
            title={strategy.name}
          />
          <div className="strategy-main">
            <div className="strategy-header">
              <div className="strategy-header-left">
                <div className="strategy-header-title">{strategy.name}</div>
                <div className="strategy-header-subtitle">{t.strategy.headerSubtitle}</div>
                <div className="strategy-header-meta">
                  {strategy.market} · {strategy.periodMonths} {t.strategy.months} · {strategy.budget.toLocaleString('ru-RU')}{' '}
                  {strategy.currency}
                </div>
              </div>
            </div>

            <div className="strategy-content">
              {tab === 'plan' && <StrategyPlanTab strategy={strategy} />}
              {tab === 'analysis' && <StrategyAnalysisTab strategy={strategy} />}
              {tab === 'experiments' && <StrategyExperimentsTab strategy={strategy} />}
              {tab === 'results' && <StrategyResultsTab strategy={strategy} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
