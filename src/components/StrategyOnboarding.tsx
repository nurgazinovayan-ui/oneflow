import { useState } from 'react';
import { IconPlus, IconClose, IconTarget, IconCheck } from './Icons';
import type { StrategyGoal } from '../strategyTypes';
import { STRATEGY_GOAL_LABELS } from '../strategyTypes';
import { useT, useLanguageStore } from '../i18n';
import type { StrategyV4 } from '../strategy/domain/types';
import { runBusinessUnderstandingStage, runFullPipeline, type PipelineStage } from '../strategy/services/pipeline';
import { useStrategyStore } from '../strategy/state/strategyStore';
import { formatGenerationError } from '../errorMessages';

type Phase = 'brief' | 'understanding' | 'confirming' | 'pipeline' | 'error';

const GOALS: StrategyGoal[] = ['sales', 'leads', 'awareness'];

// Compact centered card, not a full landing page. Owns the whole v4 pipeline orchestration
// itself (spec §5/§6/§58/§84): Business Understanding first with an explicit confirmation step,
// then the rest of the analysis stages run in sequence with live progress, and only the fully
// assembled StrategyV4 is committed to the store — StrategyPanel switches away from this
// component the moment that happens.
export default function StrategyOnboarding() {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const setStrategy = useStrategyStore((s) => s.setStrategy);

  const [phase, setPhase] = useState<Phase>('brief');
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<StrategyGoal | null>(null);
  const [market, setMarket] = useState('Kazakhstan');
  const [durationMonths, setDurationMonths] = useState(3);
  const [budget, setBudget] = useState(2_000_000);
  const [productDescription, setProductDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [knownAudience, setKnownAudience] = useState('');

  const [draftStrategy, setDraftStrategy] = useState<StrategyV4 | null>(null);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('understandBusiness');
  const [error, setError] = useState('');

  const LOADING_LABELS: Record<PipelineStage, string> = {
    understandBusiness: t.strategy.loadingUnderstandBusiness,
    segments: t.strategy.loadingSegments,
    jtbd: t.strategy.loadingJtbd,
    positioning: t.strategy.loadingPositioning,
    offers: t.strategy.loadingOffers,
    channels: t.strategy.loadingChannels,
    creative: t.strategy.loadingCreative,
    plan: t.strategy.loadingPlan,
  };
  const STAGE_ORDER: PipelineStage[] = ['understandBusiness', 'segments', 'jtbd', 'positioning', 'offers', 'channels', 'creative', 'plan'];
  const stageIndex = STAGE_ORDER.indexOf(pipelineStage);

  const steps = [t.strategy.onboardGoalStep, t.strategy.onboardContextStep];
  const canContinue = step === 0 ? !!goal : productDescription.trim().length > 0;

  const addPhoto = async () => {
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) setPhoto(dataUrl);
  };

  const buildBriefText = (): string => {
    const lines = [
      `Цель: ${STRATEGY_GOAL_LABELS[goal ?? 'sales'].ru}`,
      `Рынок: ${market.trim() || 'Kazakhstan'}`,
      `Горизонт: ${durationMonths} мес.`,
      `Бюджет: ${budget} ₸`,
      `Описание продукта: ${productDescription.trim()}`,
    ];
    if (websiteUrl.trim()) lines.push(`Сайт: ${websiteUrl.trim()}`);
    if (competitors.trim()) lines.push(`Конкуренты: ${competitors.trim()}`);
    if (knownAudience.trim()) lines.push(`Известная аудитория: ${knownAudience.trim()}`);
    return lines.join('\n');
  };

  const handleSubmitBrief = async () => {
    if (!goal || !productDescription.trim()) return;
    setPhase('understanding');
    setError('');
    try {
      const strategy = await runBusinessUnderstandingStage(buildBriefText(), {
        name: productDescription.trim().slice(0, 60) || 'Новая стратегия',
        objective: STRATEGY_GOAL_LABELS[goal].ru,
        market: market.trim() || 'Kazakhstan',
        budget,
        currency: '₸',
        periodMonths: durationMonths,
        locale: language,
      }, false);
      setDraftStrategy(strategy);
      setPhase('confirming');
    } catch (err) {
      setError(formatGenerationError(err));
      setPhase('brief');
    }
  };

  const handleFix = () => {
    setDraftStrategy(null);
    setPhase('brief');
    setStep(1);
  };

  const handleConfirm = async () => {
    if (!draftStrategy) return;
    const confirmed: StrategyV4 = {
      ...draftStrategy,
      businessUnderstanding: draftStrategy.businessUnderstanding
        ? { ...draftStrategy.businessUnderstanding, confirmed: true }
        : null,
    };
    setPhase('pipeline');
    setPipelineStage('segments');
    setError('');
    try {
      const finished = await runFullPipeline(confirmed, false, (stage) => setPipelineStage(stage));
      setStrategy(finished);
    } catch (err) {
      setError(formatGenerationError(err));
      setDraftStrategy(confirmed);
      setPhase('confirming');
    }
  };

  if (phase === 'understanding' || phase === 'pipeline') {
    const label = phase === 'understanding' ? t.strategy.loadingUnderstandBusiness : LOADING_LABELS[pipelineStage];
    const doneIndex = phase === 'understanding' ? -1 : stageIndex;
    return (
      <div className="strategy-onboarding-wrap">
        <div className="modal strategy-onboarding-modal strategy-loading-modal">
          <div className="strategy-onboarding-eyebrow">
            <IconTarget size={14} /> {t.strategy.title}
          </div>
          <h2>{t.strategy.onboardGenerating}</h2>
          <div className="strategy-loading-steps">
            {STAGE_ORDER.map((stage, i) => (
              <div
                key={stage}
                className={`strategy-loading-step ${
                  phase === 'pipeline' && i < doneIndex ? 'done' : phase === 'pipeline' && i === doneIndex ? 'active' : 'pending'
                }`}
              >
                <span className="strategy-loading-step-icon">
                  {phase === 'pipeline' && i < doneIndex ? (
                    <IconCheck size={11} />
                  ) : (phase === 'pipeline' && i === doneIndex) || (phase === 'understanding' && stage === 'understandBusiness') ? (
                    <span className="strategy-loading-dot" />
                  ) : null}
                </span>
                {LOADING_LABELS[stage]}
              </div>
            ))}
          </div>
          <div className="strategy-loading-current">{label}</div>
        </div>
      </div>
    );
  }

  if (phase === 'confirming' && draftStrategy?.businessUnderstanding) {
    const bu = draftStrategy.businessUnderstanding;
    return (
      <div className="strategy-onboarding-wrap">
        <div className="modal strategy-onboarding-modal strategy-confirm-modal">
          <div className="strategy-onboarding-eyebrow">
            <IconTarget size={14} /> {t.strategy.title}
          </div>
          <h2>{t.strategy.businessConfirmEyebrow}</h2>
          <div className="strategy-confirm-rows">
            <div className="strategy-confirm-row">
              <div className="strategy-confirm-label">{t.strategy.businessConfirmProductLabel}</div>
              <div className="strategy-confirm-value">{bu.product}</div>
            </div>
            <div className="strategy-confirm-row">
              <div className="strategy-confirm-label">{t.strategy.businessConfirmValueLabel}</div>
              <div className="strategy-confirm-value">{bu.value}</div>
            </div>
            <div className="strategy-confirm-row">
              <div className="strategy-confirm-label">{t.strategy.businessConfirmTodayLabel}</div>
              <div className="strategy-confirm-value">{bu.solvesTodayVia}</div>
            </div>
            <div className="strategy-confirm-row">
              <div className="strategy-confirm-label">{t.strategy.businessConfirmRiskLabel}</div>
              <div className="strategy-confirm-value">{bu.mainPurchaseRisk}</div>
            </div>
          </div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions strategy-onboarding-actions">
            <button type="button" className="secondary-btn" onClick={handleFix}>
              {t.strategy.businessConfirmFixBtn}
            </button>
            <button type="button" className="generate-btn" onClick={handleConfirm}>
              {t.strategy.businessConfirmAllCorrectBtn}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="strategy-onboarding-wrap">
      <div className="modal strategy-onboarding-modal">
        <div className="strategy-onboarding-progress">
          <div className="strategy-onboarding-progress-fill" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="strategy-onboarding-eyebrow">
          <IconTarget size={14} /> {t.strategy.title}
        </div>
        <h2>{steps[step]}</h2>
        <div className="strategy-onboarding-step-label">
          {step + 1} {t.strategy.onboardOf} {steps.length}
        </div>

        {step === 0 && (
          <div className="strategy-selection-grid">
            {GOALS.map((g) => (
              <button
                key={g}
                type="button"
                className={`strategy-selection-card ${goal === g ? 'selected' : ''}`}
                onClick={() => setGoal(g)}
              >
                {goal === g && <span className="strategy-selection-check" />}
                {STRATEGY_GOAL_LABELS[g][language]}
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="strategy-onboarding-fields">
            <label className="strategy-field-label">
              {t.strategy.marketLabel}
              <input className="node-select" type="text" value={market} onChange={(e) => setMarket(e.target.value)} />
            </label>
            <div className="strategy-field-row">
              <label className="strategy-field-label">
                {t.strategy.durationLabel}
                <input
                  className="node-select"
                  type="number"
                  min={1}
                  max={24}
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label className="strategy-field-label">
                {t.strategy.budgetLabel}
                <input
                  className="node-select"
                  type="number"
                  min={0}
                  step={10000}
                  value={budget}
                  onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>
            <label className="strategy-field-label">
              {t.strategy.descriptionLabel}
              <textarea
                className="node-textarea"
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder={t.strategy.descriptionPlaceholder}
              />
            </label>
            <label className="strategy-field-label">
              {t.strategy.photoLabel}
              {photo ? (
                <div className="evaluation-slot filled strategy-onboarding-photo">
                  <img src={photo} alt="" />
                  <button className="evaluation-slot-remove" onClick={() => setPhoto(null)}>
                    <IconClose size={12} />
                  </button>
                </div>
              ) : (
                <button type="button" className="evaluation-slot empty strategy-onboarding-photo" onClick={addPhoto}>
                  <IconPlus size={18} />
                </button>
              )}
            </label>

            <button type="button" className="strategy-optional-toggle" onClick={() => setShowOptional((v) => !v)}>
              {showOptional ? t.strategy.optionalHide : t.strategy.optionalShow}
            </button>
            {showOptional && (
              <>
                <label className="strategy-field-label">
                  {t.strategy.websiteLabel}
                  <input
                    className="node-select"
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                  />
                </label>
                <label className="strategy-field-label">
                  {t.strategy.competitorsLabel}
                  <input className="node-select" type="text" value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
                </label>
                <label className="strategy-field-label">
                  {t.strategy.knownAudienceLabel}
                  <input
                    className="node-select"
                    type="text"
                    value={knownAudience}
                    onChange={(e) => setKnownAudience(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions strategy-onboarding-actions">
          {step > 0 && (
            <button type="button" className="secondary-btn" onClick={() => setStep((s) => s - 1)}>
              {t.strategy.onboardBack}
            </button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" className="generate-btn" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
              {t.strategy.onboardContinue}
            </button>
          ) : (
            <button type="button" className="generate-btn" disabled={!canContinue} onClick={handleSubmitBrief}>
              {t.strategy.onboardCreate}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
