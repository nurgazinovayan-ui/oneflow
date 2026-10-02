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

  const [dragOver, setDragOver] = useState(false);
  const platformOptions = ADAPT_PRESETS.map((preset) => {
    const label = preset.key === 'RSYA' ? t.nodes.modelMeta.yandexNetwork : preset.label;
    return { value: label, label };
  });

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  // Same data-URL shape window.api.pickImageFile returns, so dropped files go down the same path.
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    const room = MAX_IMAGES - images.length;
    const urls = await Promise.all(
      files.slice(0, Math.max(0, room)).map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(f);
          })
      )
    );
    if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
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

  const dropProps = {
    onDragOver,
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => void onDrop(e),
  };
  const howto = (
    <>
      <div className="v2-lab">
        <span>{t.evaluation.noteHowLabel}</span>
      </div>
      <ol className="v2-numlist">
        {t.evaluation.noteHowItems.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
    </>
  );

  return (
    <div className={`evaluation-panel v2-mode v2-pred ${active ? '' : 'evaluation-hidden'}`}>
      <div className="v2-toolbar">
        <span className="v2-lab v2-lab-inline">{t.evaluation.platformLabel}</span>
        <div className="v2-chips" role="radiogroup" aria-label={t.evaluation.platformLabel}>
          {[{ value: '', label: t.evaluation.platformAny }, ...platformOptions].map((opt) => (
            <button
              key={opt.value || 'any'}
              type="button"
              role="radio"
              aria-checked={platform === opt.value}
              className={`v2-chip${platform === opt.value ? ' on' : ''}`}
              onClick={() => setPlatform(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="v2-toolbar-spacer" />
        <span className="v2-pill">
          {t.evaluation.uploadSectionLabel} {images.length}/{MAX_IMAGES}
        </span>
        <button type="button" className="v2-btn2" onClick={addImage} disabled={images.length >= MAX_IMAGES || status === 'loading'}>
          <IconPlus size={14} />
          {t.evaluation.addImageTooltip}
        </button>
        <button type="button" className="v2-cta v2-cta-sm" onClick={handleEvaluate} disabled={status === 'loading' || images.length === 0}>
          <IconGauge size={14} />
          {status === 'loading' ? t.evaluation.evaluatingBtn : t.evaluation.evaluateBtn}
        </button>
      </div>
      {status === 'error' && <div className="error-text v2-error">{error}</div>}

      <div className="v2-pred-body">
        <section className={`v2-card v2-pred-main${dragOver ? ' over' : ''}`} {...dropProps}>
          {images.length === 0 ? (
            <button type="button" className="v2-pred-drop" onClick={addImage}>
              <span className="v2-empty-icon">
                <IconPlus size={22} />
              </span>
              <h2>{t.ux.evalDropTitle}</h2>
              <p>{t.ux.evalDropHint}</p>
              <p className="v2-hint">{t.ux.evalNeedImage}</p>
              <span className="v2-ghosts" aria-hidden="true">
                {[1, 2, 3].map((n) => (
                  <span key={n}>{t.ux.variantN(n)}</span>
                ))}
              </span>
            </button>
          ) : (
            <div className="v2-pred-grid">
              {images.map((src, i) => {
                const variant = status !== 'loading' ? result?.variants[i] : undefined;
                const winner = !!variant && result?.winnerIndex === i;
                return (
                  <div key={i} className={`v2-pred-card${winner ? ' winner' : ''}${status === 'loading' ? ' loading' : ''}`}>
                    <div className="v2-pred-thumb">
                      <img src={src} alt="" />
                      <span className="v2-pred-index">{i + 1}</span>
                      {status !== 'loading' && (
                        <button
                          type="button"
                          className="v2-icon-btn v2-pred-remove"
                          onClick={() => removeImage(i)}
                          title={t.evaluation.removeImageTooltip}
                          aria-label={t.evaluation.removeImageTooltip}
                        >
                          <IconClose size={12} />
                        </button>
                      )}
                      {status === 'loading' && (
                        <span className="v2-pred-loading">
                          <IconRefresh size={11} />
                          {t.evaluation.loadingMessages[loadingMessageIndex]}
                        </span>
                      )}
                    </div>
                    {variant && (
                      <>
                        <div className="v2-pred-score">
                          <b>{variant.score}</b>
                          <span>{t.evaluation.scoreOutOf}</span>
                          {winner && <span className="v2-pill v2-pill-accent">{t.evaluation.winnerBadge}</span>}
                        </div>
                        {variant.strengths.length > 0 && (
                          <>
                            <div className="v2-lab">
                              <span>{t.evaluation.strengthsLabel}</span>
                            </div>
                            <ul className="v2-plus">
                              {variant.strengths.map((x, si) => (
                                <li key={si}>{x}</li>
                              ))}
                            </ul>
                          </>
                        )}
                        {variant.weaknesses.length > 0 && (
                          <>
                            <div className="v2-lab">
                              <span>{t.evaluation.weaknessesLabel}</span>
                            </div>
                            <ul className="v2-minus">
                              {variant.weaknesses.map((x, wi) => (
                                <li key={wi}>{x}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                    {status === 'loading' && (
                      <>
                        <div className="evaluation-skeleton-line wide" />
                        <div className="evaluation-skeleton-line" />
                        <div className="evaluation-skeleton-line short" />
                      </>
                    )}
                  </div>
                );
              })}
              {images.length < MAX_IMAGES && status !== 'loading' && (
                <button type="button" className="v2-pred-add" onClick={addImage}>
                  <IconPlus size={18} />
                  <span>{t.evaluation.addImageTooltip}</span>
                </button>
              )}
            </div>
          )}
        </section>

        {status !== 'loading' && result?.verdict ? (
          <section className="v2-card v2-pred-side v2-pred-verdict">
            <div className="v2-card-head">
              <b>{t.evaluation.verdictLabel}</b>
            </div>
            <p className="v2-pred-verdict-text">{result.verdict}</p>
            <div className="v2-pred-verdict-how">
              <b>{t.evaluation.noteTitle}</b>
              <p>{t.evaluation.noteHowItems.join(' · ')}</p>
            </div>
          </section>
        ) : (
          <section className="v2-card v2-pred-side">
            <div className="v2-card-head">
              <b>{t.evaluation.noteTitle}</b>
            </div>
            <p className="v2-text">{t.evaluation.subtitle}</p>
            {howto}
            <div className="v2-lab">
              <span>{t.evaluation.noteTipLabel}</span>
            </div>
            <p className="v2-note">{t.evaluation.noteTip}</p>
            <p className="v2-hint">{t.evaluation.noteAccuracy}</p>
          </section>
        )}
      </div>
    </div>
  );
}
