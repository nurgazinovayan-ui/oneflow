import { IconRocket } from './Icons';
import type { AudienceSegment, ChannelAllocation, StrategyBrief, StrategyData } from '../strategyTypes';
import { STRATEGY_GOAL_LABELS } from '../strategyTypes';
import { useT, useLanguageStore, type Translations } from '../i18n';

interface StrategyOverviewProps {
  data: StrategyData;
  brief: StrategyBrief;
  onOpenAudience: (segment: AudienceSegment) => void;
  onOpenChannel: (channel: ChannelAllocation) => void;
  onOpenOffer: () => void;
  onCreateFromAudience: (segment: AudienceSegment) => void;
}

function scoreLabel(t: Translations, score: number): string {
  if (score >= 80) return t.strategy.scoreExcellent;
  if (score >= 65) return t.strategy.scoreGood;
  if (score >= 45) return t.strategy.scoreFair;
  return t.strategy.scoreWeak;
}

export default function StrategyOverview({
  data,
  brief,
  onOpenAudience,
  onOpenChannel,
  onOpenOffer,
  onCreateFromAudience,
}: StrategyOverviewProps) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);

  const SCORE_METRICS: { key: keyof StrategyData['score']; label: string }[] = [
    { key: 'audience', label: t.strategy.scoreMetricAudience },
    { key: 'positioning', label: t.strategy.scoreMetricPositioning },
    { key: 'offer', label: t.strategy.scoreMetricOffer },
    { key: 'channels', label: t.strategy.scoreMetricChannels },
    { key: 'content', label: t.strategy.scoreMetricContent },
    { key: 'retention', label: t.strategy.scoreMetricRetention },
  ];

  const STAGE_LABELS: Record<'awareness' | 'consideration' | 'conversion', string> = {
    awareness: t.strategy.stageAwareness,
    consideration: t.strategy.stageConsideration,
    conversion: t.strategy.stageConversion,
  };
  return (
    <div className="strategy-grid">
      <div className="strategy-card strategy-card-score">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.scoreTitle}</span>
        </div>
        <div className="strategy-score-main">
          <div className="strategy-score-number">{data.score.overall}</div>
          <div className="strategy-score-suffix">/100</div>
          <div className="strategy-score-badge">{scoreLabel(t, data.score.overall)}</div>
        </div>
        <div className="strategy-score-bars">
          {SCORE_METRICS.map((m) => (
            <div key={m.key} className="strategy-score-bar-row">
              <span className="strategy-score-bar-label">{m.label}</span>
              <span className="strategy-score-bar-track">
                <span className="strategy-score-bar-fill" style={{ width: `${data.score[m.key]}%` }} />
              </span>
              <span className="strategy-score-bar-value">{data.score[m.key]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-goal">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.goalCardTitle}</span>
        </div>
        <div className="strategy-goal-value">{STRATEGY_GOAL_LABELS[brief.goal][language]}</div>
        <div className="strategy-goal-meta">
          {brief.market} · {brief.durationMonths} {t.strategy.months} · {brief.budget.toLocaleString('ru-RU')} {brief.currency}
        </div>
      </div>

      <button type="button" className="strategy-card strategy-card-clickable strategy-card-offer" onClick={onOpenOffer}>
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.positioningCardTitle}</span>
        </div>
        <p className="strategy-card-text">{data.positioning}</p>
      </button>

      <button type="button" className="strategy-card strategy-card-clickable strategy-card-offer" onClick={onOpenOffer}>
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.offerCardTitle}</span>
        </div>
        <p className="strategy-card-text">{data.offer}</p>
      </button>

      <div className="strategy-card strategy-card-audience-group">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.audienceCardTitle}</span>
          <span className="strategy-card-subtitle">
            {data.audience.length} {t.strategy.segments}
          </span>
        </div>
        <div className="strategy-audience-row">
          {data.audience.map((seg) => (
            <div key={seg.name} className="strategy-audience-card">
              <div className="strategy-audience-card-top">
                <span className="strategy-audience-name">{seg.name}</span>
                <span className={`strategy-potential-badge strategy-potential-${seg.potential.toLowerCase()}`}>
                  {seg.potential} {t.strategy.potentialLabel}
                </span>
              </div>
              <p className="strategy-audience-desc">{seg.description}</p>
              {seg.painPoints.length > 0 && (
                <ul className="strategy-audience-pains">
                  {seg.painPoints.slice(0, 3).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="strategy-audience-actions">
                <button type="button" className="secondary-btn strategy-small-btn" onClick={() => onOpenAudience(seg)}>
                  {t.strategy.openBtn}
                </button>
                <button
                  type="button"
                  className="generate-btn strategy-small-btn"
                  onClick={() => onCreateFromAudience(seg)}
                >
                  <IconRocket size={12} /> {t.strategy.createBtn}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-channels">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.channelsCardTitle}</span>
        </div>
        <div className="strategy-channel-bars">
          {data.channels.map((c) => (
            <button key={c.name} type="button" className="strategy-channel-row" onClick={() => onOpenChannel(c)}>
              <div className="strategy-channel-top">
                <span className="strategy-channel-name">{c.name}</span>
                <span className="strategy-channel-percent">{c.percent}%</span>
                <span className="strategy-channel-budget">
                  {Math.round((brief.budget * c.percent) / 100).toLocaleString('ru-RU')} {brief.currency}
                </span>
              </div>
              <span className="strategy-channel-track">
                <span className="strategy-channel-fill" style={{ width: `${c.percent}%` }} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-risks">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.risksCardTitle}</span>
          <span className="strategy-card-subtitle">{data.risks.length}</span>
        </div>
        <div className="strategy-note-list">
          {data.risks.map((r, i) => (
            <div key={i} className="strategy-note strategy-note-risk">
              <span className="strategy-note-icon">!</span>
              <div>
                <div className="strategy-note-title">{r.title}</div>
                <div className="strategy-note-desc">{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-opportunities">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.opportunitiesCardTitle}</span>
          <span className="strategy-card-subtitle">{data.opportunities.length}</span>
        </div>
        <div className="strategy-note-list">
          {data.opportunities.map((o, i) => (
            <div key={i} className="strategy-note strategy-note-opportunity">
              <span className="strategy-note-icon">↑</span>
              <div>
                <div className="strategy-note-title">{o.title}</div>
                <div className="strategy-note-desc">{o.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-matrix">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.contentMatrixTitle}</span>
        </div>
        <div className="strategy-matrix">
          <div className="strategy-matrix-row strategy-matrix-header-row">
            <div className="strategy-matrix-cell strategy-matrix-format-cell" />
            {(['awareness', 'consideration', 'conversion'] as const).map((stage) => (
              <div key={stage} className="strategy-matrix-cell strategy-matrix-header-cell">
                {STAGE_LABELS[stage]}
              </div>
            ))}
          </div>
          {data.contentMatrix.map((row) => (
            <div key={row.format} className="strategy-matrix-row">
              <div className="strategy-matrix-cell strategy-matrix-format-cell">{row.format}</div>
              {(['awareness', 'consideration', 'conversion'] as const).map((stage) => (
                <div key={stage} className="strategy-matrix-cell">
                  {row.stages.includes(stage) && <span className="strategy-matrix-dot" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-funnel">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.funnelCardTitle}</span>
        </div>
        <div className="strategy-funnel">
          {data.funnel.map((stage, i) => (
            <div key={stage.label} className="strategy-funnel-stage">
              <div className="strategy-funnel-value">{stage.value.toLocaleString('ru-RU')}</div>
              <div className="strategy-funnel-label">{stage.label}</div>
              {i < data.funnel.length - 1 && stage.conversionToNext !== undefined && (
                <div className="strategy-funnel-connector">
                  <span className="strategy-funnel-connector-line" />
                  <span className="strategy-funnel-connector-value">{stage.conversionToNext}%</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
