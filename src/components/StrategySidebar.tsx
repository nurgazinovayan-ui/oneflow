import { IconGauge, IconVector, IconFlow, IconDocument, IconTarget, IconChevronRight, IconCheck } from './Icons';
import { useT } from '../i18n';
import type { Readiness } from '../strategy/domain/types';

export type StrategyTab = 'plan' | 'analysis' | 'experiments' | 'results';

interface StrategySidebarProps {
  tab: StrategyTab;
  onTabChange: (tab: StrategyTab) => void;
  onReset: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  readiness: Readiness;
  title: string;
}

// Ported from the shadcn-dashboard-landing-template's AppSidebar/nav-main pattern onto ONEFLOW's
// own --c-* tokens. Footer shows a readiness checklist (spec §36) instead of a raw numeric
// "Strategy Score" — the spec explicitly forbids defaulting to "82/100" without explanation.
export default function StrategySidebar({ tab, onTabChange, onReset, collapsed, onToggleCollapsed, readiness, title }: StrategySidebarProps) {
  const t = useT();

  const navItems: { key: StrategyTab; label: string; icon: typeof IconGauge }[] = [
    { key: 'plan', label: t.strategy.tabPlanV4, icon: IconGauge },
    { key: 'analysis', label: t.strategy.tabAnalysisV4, icon: IconFlow },
    { key: 'experiments', label: t.strategy.tabExperimentsV4, icon: IconVector },
    { key: 'results', label: t.strategy.tabResultsV4, icon: IconDocument },
  ];

  const doneCount = readiness.items.filter((i) => i.done).length;
  const allReady = readiness.items.length > 0 && doneCount === readiness.items.length;

  return (
    <aside className={`strategy-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="strategy-sidebar-header">
        <span className="strategy-sidebar-logo">
          <IconTarget size={16} />
        </span>
        {!collapsed && <span className="strategy-sidebar-title">{title}</span>}
      </div>

      <div className="strategy-sidebar-content">
        <div className="strategy-sidebar-group">
          {!collapsed && <div className="strategy-sidebar-group-label">{t.strategy.sidebarNavGroupLabel}</div>}
          <div className="strategy-sidebar-menu">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`strategy-sidebar-item ${tab === item.key ? 'active' : ''}`}
                  onClick={() => onTabChange(item.key)}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={16} />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="strategy-sidebar-footer">
        {!collapsed && (
          <div className={`strategy-sidebar-readiness ${allReady ? 'ready' : ''}`}>
            <div className="strategy-sidebar-readiness-title">{allReady ? t.strategy.readinessReadyTitle : t.strategy.readinessNeedsTitle}</div>
            <ul className="strategy-sidebar-readiness-list">
              {readiness.items.map((item) => (
                <li key={item.label} className={item.done ? 'done' : ''}>
                  {item.done ? <IconCheck size={10} /> : <span className="strategy-sidebar-readiness-dot" />}
                  {item.label}
                </li>
              ))}
              {readiness.blockers.map((b) => (
                <li key={b.label} className="blocker">
                  ! {b.label}
                </li>
              ))}
            </ul>
            {readiness.nextStepLabel && (
              <div className="strategy-sidebar-readiness-next">
                <span>{t.strategy.readinessNextStepLabel}:</span> {readiness.nextStepLabel}
              </div>
            )}
          </div>
        )}
        <div className="strategy-sidebar-footer-actions">
          {!collapsed && (
            <button type="button" className="secondary-btn strategy-sidebar-reset-btn" onClick={onReset}>
              {t.strategy.newStrategyBtn}
            </button>
          )}
          <button
            type="button"
            className="strategy-sidebar-toggle"
            onClick={onToggleCollapsed}
            title={collapsed ? t.strategy.sidebarExpandTooltip : t.strategy.sidebarCollapseTooltip}
          >
            <IconChevronRight size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
