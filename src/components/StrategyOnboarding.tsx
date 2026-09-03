import { useState } from 'react';
import { IconPlus, IconClose, IconTarget } from './Icons';
import type { StrategyBrief, StrategyGoal } from '../strategyTypes';
import { STRATEGY_GOAL_LABELS } from '../strategyTypes';
import { useT, useLanguageStore } from '../i18n';

interface StrategyOnboardingProps {
  status: 'idle' | 'generating' | 'error';
  error: string;
  onGenerate: (brief: StrategyBrief) => void;
}

const GOALS: StrategyGoal[] = ['sales', 'leads', 'awareness'];

// Compact centered card, not a full landing page — per the spec's "Onboarding не должен
// выглядеть как отдельный лендинг" note. Website-URL analysis (spec section 39) isn't wired up
// here — there's no backend endpoint yet that fetches/summarizes an arbitrary URL, so this
// collects a plain text description (+ optional product photo) instead.
export default function StrategyOnboarding({ status, error, onGenerate }: StrategyOnboardingProps) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<StrategyGoal | null>(null);
  const [market, setMarket] = useState('Kazakhstan');
  const [durationMonths, setDurationMonths] = useState(3);
  const [budget, setBudget] = useState(2_000_000);
  const [productDescription, setProductDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const steps = [t.strategy.onboardGoalStep, t.strategy.onboardContextStep];
  const canContinue = step === 0 ? !!goal : productDescription.trim().length > 0;

  const addPhoto = async () => {
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) setPhoto(dataUrl);
  };

  const handleSubmit = () => {
    if (!goal || !productDescription.trim()) return;
    onGenerate({
      goal,
      market: market.trim() || 'Kazakhstan',
      durationMonths,
      budget,
      currency: '₸',
      productDescription: productDescription.trim(),
      photo,
    });
  };

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
              <input
                className="node-select"
                type="text"
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              />
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
          </div>
        )}

        {status === 'error' && <div className="error-text">{error}</div>}

        <div className="modal-actions strategy-onboarding-actions">
          {step > 0 && (
            <button type="button" className="secondary-btn" onClick={() => setStep((s) => s - 1)}>
              {t.strategy.onboardBack}
            </button>
          )}
          {step < steps.length - 1 ? (
            <button
              type="button"
              className="generate-btn"
              disabled={!canContinue}
              onClick={() => setStep((s) => s + 1)}
            >
              {t.strategy.onboardContinue}
            </button>
          ) : (
            <button
              type="button"
              className="generate-btn"
              disabled={!canContinue || status === 'generating'}
              onClick={handleSubmit}
            >
              {status === 'generating' ? t.strategy.onboardGenerating : t.strategy.onboardCreate}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
