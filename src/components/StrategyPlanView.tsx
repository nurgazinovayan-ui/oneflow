import { IconSparkles } from './Icons';
import type { PlanTask } from '../strategyTypes';
import { useT } from '../i18n';

interface StrategyPlanViewProps {
  tasks: PlanTask[];
  onGenerate: (task: PlanTask) => void;
}

// Hybrid timeline + task list per spec section 36 — one vertical rail with a day marker per
// task rather than a full calendar grid (which would need real date math the strategy JSON
// doesn't provide, just relative "day 1 of the week" labels).
export default function StrategyPlanView({ tasks, onGenerate }: StrategyPlanViewProps) {
  const t = useT();
  return (
    <div className="strategy-plan">
      <div className="strategy-plan-title">{t.strategy.planThisWeek}</div>
      <div className="strategy-plan-list">
        {tasks.map((task, i) => (
          <div key={i} className="strategy-plan-row">
            <div className="strategy-plan-day">{task.day}</div>
            <div className="strategy-plan-body">
              <div className="strategy-plan-task-title">{task.title}</div>
              <div className="strategy-plan-task-tag">{task.tag}</div>
            </div>
            <button type="button" className="secondary-btn strategy-small-btn" onClick={() => onGenerate(task)}>
              <IconSparkles size={12} /> {t.strategy.generateBtn}
            </button>
            {i < tasks.length - 1 && <div className="strategy-plan-connector" />}
          </div>
        ))}
      </div>
    </div>
  );
}
