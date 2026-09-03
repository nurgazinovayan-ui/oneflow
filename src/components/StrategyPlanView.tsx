import { IconSparkles, IconGauge, IconFlow, IconCheck, IconChat } from './Icons';
import type { PlanTask, PlanTaskType } from '../strategyTypes';
import { useT, type Translations } from '../i18n';

interface StrategyPlanViewProps {
  tasks: PlanTask[];
  onGenerate: (task: PlanTask) => void;
  onToggleDone: (taskId: string) => void;
  onReview: () => void;
}

const TYPE_ICON: Record<PlanTaskType, typeof IconSparkles> = {
  generate: IconSparkles,
  score: IconGauge,
  compare: IconFlow,
  manual: IconCheck,
  review: IconChat,
};

function typeLabel(t: Translations, type: PlanTaskType): string {
  switch (type) {
    case 'generate':
      return t.strategy.planTypeGenerate;
    case 'score':
      return t.strategy.planTypeScore;
    case 'compare':
      return t.strategy.planTypeCompare;
    case 'manual':
      return t.strategy.planTypeManual;
    case 'review':
      return t.strategy.planTypeReview;
  }
}

// Hybrid timeline + task list per spec section 36 — one vertical rail with a day marker per
// task. Task type (generate/score/compare/manual/review, spec section 13) decides the action:
// generate/score/compare open the matching flow, manual is a plain checkbox (ONEFLOW can't
// actually launch an ad campaign), review focuses the AI Assistant instead of generating anything.
export default function StrategyPlanView({ tasks, onGenerate, onToggleDone, onReview }: StrategyPlanViewProps) {
  const t = useT();
  return (
    <div className="strategy-plan">
      <div className="strategy-plan-title">{t.strategy.planThisWeek}</div>
      <div className="strategy-plan-list">
        {tasks.map((task, i) => {
          const Icon = TYPE_ICON[task.type];
          return (
            <div key={task.id} className={`strategy-plan-row ${task.done ? 'done' : ''}`}>
              <div className="strategy-plan-day">{task.day}</div>
              <div className="strategy-plan-body">
                <div className="strategy-plan-task-title">
                  <span className="strategy-plan-type-badge" title={typeLabel(t, task.type)}>
                    <Icon size={11} />
                  </span>
                  {task.title}
                </div>
                <div className="strategy-plan-task-tag">{task.tag}</div>
              </div>
              {task.type === 'manual' ? (
                <button
                  type="button"
                  className={`secondary-btn strategy-small-btn ${task.done ? 'strategy-plan-done-btn' : ''}`}
                  onClick={() => onToggleDone(task.id)}
                >
                  <IconCheck size={12} /> {task.done ? t.strategy.planDoneBtn : t.strategy.planMarkDoneBtn}
                </button>
              ) : task.type === 'review' ? (
                <button type="button" className="secondary-btn strategy-small-btn" onClick={onReview}>
                  <IconChat size={12} /> {t.strategy.planTypeReview}
                </button>
              ) : (
                <button type="button" className="secondary-btn strategy-small-btn" onClick={() => onGenerate(task)}>
                  <IconSparkles size={12} /> {t.strategy.generateBtn}
                </button>
              )}
              {i < tasks.length - 1 && <div className="strategy-plan-connector" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
