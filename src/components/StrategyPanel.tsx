import { useState } from 'react';
import StrategyOnboarding from './StrategyOnboarding';
import StrategyOverview from './StrategyOverview';
import StrategyMap from './StrategyMap';
import StrategyPlanView from './StrategyPlanView';
import StrategyAssistantPanel from './StrategyAssistantPanel';
import StrategyDetailDrawer, { type StrategyDetailTarget } from './StrategyDetailDrawer';
import StrategyScenarioModal from './StrategyScenarioModal';
import CreateFromStrategyModal from './CreateFromStrategyModal';
import type { AudienceSegment, ChannelAllocation, PlanTask, StrategyAction, StrategyBrief, StrategyData } from '../strategyTypes';
import {
  buildStrategyPrompt,
  buildStrategyWorkflowPrompt,
  buildOfferAlternativesPrompt,
  parseStrategyResponse,
  parseOfferAlternatives,
} from '../strategyPrompts';
import { applyStrategyAction, StrategyActionError } from '../strategyActions';
import { computeOverallScore } from '../strategyCompute';
import { formatGenerationError } from '../errorMessages';
import { IconVector } from './Icons';
import { useT } from '../i18n';

interface StrategyPanelProps {
  active: boolean;
  onCreateWorkflow: (prompt: string) => void;
}

type StrategyTab = 'overview' | 'map' | 'plan';

// Top-level "Стратегия" mode — see the implementation brief this was built from for the full
// spec. Mounted like every other main-view panel in App.tsx (always in the DOM, hidden via CSS
// when `active` is false, per the existing OneLaunchPanel/EvaluationPanel/MusicAudioPanel
// pattern), so its own state (the generated strategy) survives switching tabs and back.
//
// Not persisted to a project file — there's no backend schema for strategy data yet, unlike
// node-canvas projects — so it lives in this component's state for the session. Every mutation
// (funnel edit, budget normalize, offer/positioning switch, Insight Apply, Assistant action)
// goes through applyStrategyAction so it's validated and logged to data.history the same way,
// per spec §20/§25.
export default function StrategyPanel({ active, onCreateWorkflow }: StrategyPanelProps) {
  const t = useT();
  const [brief, setBrief] = useState<StrategyBrief | null>(null);
  const [data, setData] = useState<StrategyData | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'error'>('idle');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [tab, setTab] = useState<StrategyTab>('overview');
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [drawerTarget, setDrawerTarget] = useState<StrategyDetailTarget | null>(null);
  const [createModalAudience, setCreateModalAudience] = useState<string | null | undefined>(undefined);
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false);
  const [generatingOffers, setGeneratingOffers] = useState(false);

  const handleGenerate = async (b: StrategyBrief) => {
    setBrief(b);
    setStatus('generating');
    setError('');
    try {
      const images = b.photo ? [b.photo] : undefined;
      const reply = await window.api.generateChat([{ role: 'user', content: buildStrategyPrompt(b) }], images, 'text');
      const parsed = parseStrategyResponse(reply);
      setData(parsed);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  const handleReset = () => {
    setBrief(null);
    setData(null);
    setStatus('idle');
    setTab('overview');
    setDrawerTarget(null);
  };

  const handleApplyAction = (action: StrategyAction) => {
    if (!data) return;
    setActionError('');
    try {
      const { data: next, event } = applyStrategyAction(data, action);
      setData({ ...next, history: [...next.history, event] });
    } catch (err) {
      setActionError(err instanceof StrategyActionError ? err.message : formatGenerationError(err));
    }
  };

  const handleGenerateOfferAlternatives = async () => {
    if (!data || !brief || generatingOffers) return;
    setGeneratingOffers(true);
    setActionError('');
    try {
      const reply = await window.api.generateChat(
        [{ role: 'user', content: buildOfferAlternativesPrompt(data, brief) }],
        undefined,
        'text'
      );
      const newOffers = parseOfferAlternatives(reply, data.audience);
      setData((prev) => (prev ? { ...prev, offers: [...prev.offers, ...newOffers] } : prev));
    } catch (err) {
      setActionError(formatGenerationError(err));
    } finally {
      setGeneratingOffers(false);
    }
  };

  const handleToggleTaskDone = (taskId: string) => {
    setData((prev) =>
      prev ? { ...prev, plan: prev.plan.map((task) => (task.id === taskId ? { ...task, done: !task.done } : task)) } : prev
    );
  };

  const handleReview = () => {
    setAssistantCollapsed(false);
  };

  const handleCreateFromDrawer = (target: StrategyDetailTarget) => {
    const audienceName = target.kind === 'audience' ? target.segment.name : undefined;
    setDrawerTarget(null);
    setCreateModalAudience(audienceName ?? null);
  };

  const handleCreateFromPlanTask = (task: PlanTask) => {
    if (!data) return;
    onCreateWorkflow(buildStrategyWorkflowPrompt(data, undefined, task.title));
  };

  const handleCreateModalSubmit = (prompt: string) => {
    onCreateWorkflow(prompt);
  };

  return (
    <div className={`strategy-panel ${active ? '' : 'strategy-hidden'}`}>
      {!data ? (
        <StrategyOnboarding status={status} error={error} onGenerate={handleGenerate} />
      ) : (
        <div className="strategy-shell">
          <div className="strategy-main">
            <div className="strategy-header">
              <div className="strategy-header-left">
                <div className="strategy-header-title">{data.title}</div>
                <div className="strategy-header-subtitle">{t.strategy.headerSubtitle}</div>
                <div className="strategy-header-meta">
                  {brief!.market} · {brief!.durationMonths} {t.strategy.months} ·{' '}
                  {brief!.budget.toLocaleString('ru-RU')} {brief!.currency}
                </div>
              </div>
              <div className="strategy-header-right">
                <div className="strategy-tabs">
                  <button
                    type="button"
                    className={`strategy-tab ${tab === 'overview' ? 'active' : ''}`}
                    onClick={() => setTab('overview')}
                  >
                    {t.strategy.tabOverview}
                  </button>
                  <button type="button" className={`strategy-tab ${tab === 'map' ? 'active' : ''}`} onClick={() => setTab('map')}>
                    {t.strategy.tabMap}
                  </button>
                  <button type="button" className={`strategy-tab ${tab === 'plan' ? 'active' : ''}`} onClick={() => setTab('plan')}>
                    {t.strategy.tabPlan}
                  </button>
                </div>
                <button type="button" className="secondary-btn strategy-small-btn" onClick={() => setScenarioModalOpen(true)}>
                  <IconVector size={12} /> {t.strategy.scenarioCompareBtn}
                </button>
                <div className="strategy-score-pill">{computeOverallScore(data.scoreBreakdown)} / 100</div>
                <button type="button" className="secondary-btn strategy-small-btn" onClick={handleReset}>
                  {t.strategy.newStrategyBtn}
                </button>
              </div>
            </div>

            {actionError && (
              <div className="strategy-action-error">
                {actionError}
                <button type="button" className="strategy-inline-link" onClick={() => setActionError('')}>
                  {t.strategy.dismissBtn}
                </button>
              </div>
            )}

            <div className="strategy-content">
              {tab === 'overview' && (
                <StrategyOverview
                  data={data}
                  brief={brief!}
                  onOpenAudience={(segment) => setDrawerTarget({ kind: 'audience', segment })}
                  onOpenChannel={(channel) => setDrawerTarget({ kind: 'channel', channel })}
                  onOpenOffer={() => setDrawerTarget({ kind: 'offer' })}
                  onCreateFromAudience={(segment: AudienceSegment) => setCreateModalAudience(segment.name)}
                  onApplyAction={handleApplyAction}
                  onGenerateOfferAlternatives={handleGenerateOfferAlternatives}
                  generatingOffers={generatingOffers}
                />
              )}
              {tab === 'map' && (
                <StrategyMap
                  data={data}
                  onOpenAudience={(segment) => setDrawerTarget({ kind: 'audience', segment })}
                  onOpenChannel={(channel: ChannelAllocation) => setDrawerTarget({ kind: 'channel', channel })}
                  onOpenOffer={() => setDrawerTarget({ kind: 'offer' })}
                />
              )}
              {tab === 'plan' && (
                <StrategyPlanView
                  tasks={data.plan}
                  onGenerate={handleCreateFromPlanTask}
                  onToggleDone={handleToggleTaskDone}
                  onReview={handleReview}
                />
              )}
            </div>
          </div>

          <StrategyAssistantPanel
            data={data}
            brief={brief!}
            collapsed={assistantCollapsed}
            onToggleCollapsed={() => setAssistantCollapsed((c) => !c)}
            onApplyAction={handleApplyAction}
          />
        </div>
      )}

      {drawerTarget && (
        <StrategyDetailDrawer
          target={drawerTarget}
          data={data!}
          budget={brief!.budget}
          onClose={() => setDrawerTarget(null)}
          onCreate={handleCreateFromDrawer}
        />
      )}
      {createModalAudience !== undefined && data && (
        <CreateFromStrategyModal
          data={data}
          initialAudienceName={createModalAudience ?? undefined}
          onClose={() => setCreateModalAudience(undefined)}
          onCreate={handleCreateModalSubmit}
        />
      )}
      {scenarioModalOpen && data && brief && (
        <StrategyScenarioModal data={data} brief={brief} onClose={() => setScenarioModalOpen(false)} />
      )}
    </div>
  );
}
