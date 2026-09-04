import { IconGauge, IconFlow, IconDocument, IconVector, IconTarget, IconChevronRight } from './Icons';
import { useT } from '../i18n';

export type StrategyTab = 'overview' | 'map' | 'plan';

interface StrategySidebarProps {
  tab: StrategyTab;
  onTabChange: (tab: StrategyTab) => void;
  onOpenScenarios: () => void;
  onReset: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  score: number;
  title: string;
}

// Ported from the shadcn-dashboard-landing-template's AppSidebar/nav-main pattern (grouped,
// collapsible-to-icon-only left nav) onto ONEFLOW's own --c-* tokens — no Tailwind/shadcn here,
// same porting approach as GlowMenuBar.tsx and the login screen earlier. Replaces the
// Overview/Map/Plan pill row that used to live in .strategy-header; those three destinations,
// plus the scenario-compare and reset actions that used to sit next to them, now live here.
export default function StrategySidebar({
  tab,
  onTabChange,
  onOpenScenarios,
  onReset,
  collapsed,
  onToggleCollapsed,
  score,
  title,
}: StrategySidebarProps) {
  const t = useT();

  const navItems: { key: StrategyTab; label: string; icon: typeof IconGauge }[] = [
    { key: 'overview', label: t.strategy.tabOverview, icon: IconGauge },
    { key: 'map', label: t.strategy.tabMap, icon: IconFlow },
    { key: 'plan', label: t.strategy.tabPlan, icon: IconDocument },
  ];

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

        <div className="strategy-sidebar-group">
          {!collapsed && <div className="strategy-sidebar-group-label">{t.strategy.sidebarToolsGroupLabel}</div>}
          <div className="strategy-sidebar-menu">
            <button
              type="button"
              className="strategy-sidebar-item"
              onClick={onOpenScenarios}
              title={collapsed ? t.strategy.scenarioCompareBtn : undefined}
            >
              <IconVector size={16} />
              {!collapsed && <span>{t.strategy.scenariosNavLabel}</span>}
            </button>
          </div>
        </div>
      </div>

      <div className="strategy-sidebar-footer">
        <div className="strategy-sidebar-score" title="Strategy Score">
          <span className="strategy-sidebar-score-value">{score}</span>
          {!collapsed && <span className="strategy-sidebar-score-suffix">/100</span>}
        </div>
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
    </aside>
  );
}
