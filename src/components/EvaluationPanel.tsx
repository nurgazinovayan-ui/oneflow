import { useEffect, useState } from 'react';
import { IconClose, IconGauge, IconPlus, IconRefresh } from './Icons';
import { ADAPT_PRESETS, type CreativeEvaluationResult } from '../types';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface EvaluationPanelProps {
  active: boolean;
}

const MAX_IMAGES = 3;
const LOADING_MESSAGE_INTERVAL_MS = 1400;

// Web-only for now (see App.tsx — the tab that mounts this is gated behind VITE_WEB_MODE).
// Lets a user upload 1-3 variants of an ad creative and get a heuristic design-quality read
// from a vision model, rather than needing to build a node chain for a one-off check. See
// supabase/functions/evaluate-creative for why this is a 1-10 score + notes rather than a
// literal CTR percentage.
export default function EvaluationPanel({ active }: EvaluationPanelProps) {
  const t = useT();
  const [images, setImages] = useState<string[]>([]);
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreativeEvaluationResult | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  // Cycles the "Оцениваю контраст.../Проверяю читабельность..." status text shown on each
  // loading placeholder card — purely cosmetic (the real evaluation is one single request),
  // but gives a sense of progress during the several seconds a vision-model call takes.
  useEffect(() => {
    if (status !== 'loading') return;
    setLoadingMessageIndex(0);
    const id = setInterval(() => {
      setLoadingMessageIndex((i) => (i + 1) % t.evaluation.loadingMessages.length);
    }, LOADING_MESSAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, t.evaluation.loadingMessages.length]);

  const addImage = async () => {
    if (images.length >= MAX_IMAGES) return;
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) setImages((prev) => [...prev, dataUrl]);
  };

  const removeImage = (i: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
    setResult(null);
  };

  const handleEvaluate = async () => {
    if (images.length === 0) {
      setStatus('error');
      setError(t.evaluation.noImagesError);
      return;
    }
    setStatus('loading');
    setError('');
    setResult(null);
    try {
      const evaluation = await window.api.evaluateCreative(images, platform || undefined);
      setResult(evaluation);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  return (
    <div className={`evaluation-panel ${active ? '' : 'evaluation-hidden'}`}>
      <div className="evaluation-top">
        <div className="evaluation-composer">
          <div className="evaluation-header">
            <div className="evaluation-header-icon">
              <IconGauge size={18} />
            </div>
            <div>
              <div className="evaluation-title">{t.evaluation.title}</div>
              <p className="evaluation-subtitle">{t.evaluation.subtitle}</p>
            </div>
          </div>

          <div className="evaluation-section">
            <div className="evaluation-section-label">{t.evaluation.uploadSectionLabel}</div>
            <div className="evaluation-slots">
              {images.map((src, i) => (
                <div className="evaluation-slot filled" key={i}>
                  <img src={src} alt="" />
                  <button
                    className="evaluation-slot-remove"
                    onClick={() => removeImage(i)}
                    title={t.evaluation.removeImageTooltip}
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button
                  className="evaluation-slot empty"
                  onClick={addImage}
                  title={t.evaluation.addImageTooltip}
                >
                  <IconPlus size={18} />
                </button>
              )}
            </div>
            <p className="evaluation-hint">{t.evaluation.maxImagesHint}</p>
          </div>

          <div className="evaluation-section evaluation-actions-row">
            <select
              className="node-select evaluation-platform-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="">{t.evaluation.platformAny}</option>
              {ADAPT_PRESETS.map((preset) => (
                <option
                  key={preset.key}
                  value={preset.key === 'RSYA' ? t.nodes.modelMeta.yandexNetwork : preset.label}
                >
                  {preset.key === 'RSYA' ? t.nodes.modelMeta.yandexNetwork : preset.label}
                </option>
              ))}
            </select>
            <button
              className="generate-btn evaluation-evaluate-btn"
              onClick={handleEvaluate}
              disabled={status === 'loading' || images.length === 0}
            >
              <IconGauge size={14} />
              {status === 'loading' ? t.evaluation.evaluatingBtn : t.evaluation.evaluateBtn}
            </button>
          </div>

          {status === 'error' && <div className="error-text">{error}</div>}
        </div>

        <div className="evaluation-note">
          <div className="evaluation-note-title">{t.evaluation.noteTitle}</div>
          <div className="evaluation-note-block">
            <p>
              <span className="evaluation-note-label">{t.evaluation.noteHowLabel}:</span>
            </p>
            <ul className="evaluation-note-list">
              {t.evaluation.noteHowItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
          <p>
            <span className="evaluation-note-label">{t.evaluation.noteAccuracyLabel}:</span>{' '}
            {t.evaluation.noteAccuracy}
          </p>
          <p>
            <span className="evaluation-note-label">{t.evaluation.noteTipLabel}:</span>{' '}
            {t.evaluation.noteTip}
          </p>
        </div>
      </div>

      <div className="evaluation-results">
        {status === 'loading' && (
          <div className="evaluation-variant-grid">
            {images.map((src, i) => (
              <div className="evaluation-variant-card loading" key={i}>
                <div className="evaluation-variant-thumb">
                  <img src={src} alt="" />
                  <span className="evaluation-loading-badge">
                    <IconRefresh size={11} />
                    {t.evaluation.loadingMessages[loadingMessageIndex]}
                  </span>
                </div>
                <div className="evaluation-skeleton-line wide" />
                <div className="evaluation-skeleton-line" />
                <div className="evaluation-skeleton-line short" />
              </div>
            ))}
          </div>
        )}
        {status !== 'loading' && result && (
          <>
            {result.verdict && (
              <div className="evaluation-verdict">
                <span className="evaluation-verdict-label">{t.evaluation.verdictLabel}</span>
                {result.verdict}
              </div>
            )}
            <div className="evaluation-variant-grid">
              {result.variants.map((variant, i) => (
                <div
                  key={i}
                  className={`evaluation-variant-card ${result.winnerIndex === i ? 'winner' : ''}`}
                >
                  {images[i] && (
                    <div className="evaluation-variant-thumb">
                      <img src={images[i]} alt="" />
                      {result.winnerIndex === i && (
                        <span className="evaluation-winner-badge">{t.evaluation.winnerBadge}</span>
                      )}
                    </div>
                  )}
                  <div className="evaluation-score">
                    {variant.score}
                    <span className="evaluation-score-suffix">{t.evaluation.scoreOutOf}</span>
                  </div>
                  {variant.strengths.length > 0 && (
                    <div className="evaluation-feedback-group">
                      <div className="evaluation-feedback-label">{t.evaluation.strengthsLabel}</div>
                      <ul className="evaluation-strengths">
                        {variant.strengths.map((s, si) => (
                          <li key={si}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {variant.weaknesses.length > 0 && (
                    <div className="evaluation-feedback-group">
                      <div className="evaluation-feedback-label">{t.evaluation.weaknessesLabel}</div>
                      <ul className="evaluation-weaknesses">
                        {variant.weaknesses.map((w, wi) => (
                          <li key={wi}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
