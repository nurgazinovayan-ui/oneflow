import { useState } from 'react';
import { IconRocket, IconSparkles, IconCheck } from './Icons';
import type {
  AudienceSegment,
  ChannelAllocation,
  StrategyAction,
  StrategyBrief,
  StrategyData,
} from '../strategyTypes';
import { STRATEGY_GOAL_LABELS, primaryOffer } from '../strategyTypes';
import { computeChannelForecast, computeOverallScore, allocationSum } from '../strategyCompute';
import { useT, useLanguageStore, type Translations } from '../i18n';

interface StrategyOverviewProps {
  data: StrategyData;
  brief: StrategyBrief;
  onOpenAudience: (segment: AudienceSegment) => void;
  onOpenChannel: (channel: ChannelAllocation) => void;
  onOpenOffer: () => void;
  onCreateFromAudience: (segment: AudienceSegment) => void;
  onApplyAction: (action: StrategyAction) => void;
  onGenerateOfferAlternatives: () => void;
  generatingOffers: boolean;
}

function scoreLabel(t: Translations, score: number): string {
  if (score >= 80) return t.strategy.scoreExcellent;
  if (score >= 65) return t.strategy.scoreGood;
  if (score >= 45) return t.strategy.scoreFair;
  return t.strategy.scoreWeak;
}

const JOURNEY_ORDER = ['discover', 'interest', 'research', 'try', 'buy', 'return'] as const;

export default function StrategyOverview({
  data,
  brief,
  onOpenAudience,
  onOpenChannel,
  onOpenOffer,
  onCreateFromAudience,
  onApplyAction,
  onGenerateOfferAlternatives,
  generatingOffers,
}: StrategyOverviewProps) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const [channelEdits, setChannelEdits] = useState<Record<string, number>>({});
  const [editingFunnelId, setEditingFunnelId] = useState<string | null>(null);
  const [funnelDraft, setFunnelDraft] = useState('');

  const SCORE_METRICS: { key: keyof StrategyData['scoreBreakdown']; label: string }[] = [
    { key: 'audience', label: t.strategy.scoreMetricAudience },
    { key: 'positioning', label: t.strategy.scoreMetricPositioning },
    { key: 'offer', label: t.strategy.scoreMetricOffer },
    { key: 'channels', label: t.strategy.scoreMetricChannels },
    { key: 'content', label: t.strategy.scoreMetricContent },
    { key: 'funnel', label: t.strategy.scoreMetricFunnel },
    { key: 'retention', label: t.strategy.scoreMetricRetention },
    { key: 'measurement', label: t.strategy.scoreMetricMeasurement },
  ];

  const STAGE_LABELS: Record<'awareness' | 'consideration' | 'conversion', string> = {
    awareness: t.strategy.stageAwareness,
    consideration: t.strategy.stageConsideration,
    conversion: t.strategy.stageConversion,
  };

  const JOURNEY_LABELS: Record<(typeof JOURNEY_ORDER)[number], string> = {
    discover: t.strategy.journeyDiscover,
    interest: t.strategy.journeyInterest,
    research: t.strategy.journeyResearch,
    try: t.strategy.journeyTry,
    buy: t.strategy.journeyBuy,
    return: t.strategy.journeyReturn,
  };

  const overall = computeOverallScore(data.scoreBreakdown);
  const offer = primaryOffer(data.offers);
  const alternativeOffers = data.offers.filter((o) => !o.isPrimary);
  const activeRisks = data.risks.filter((r) => r.status === 'active');
  const activeOpportunities = data.opportunities.filter((o) => o.status === 'active');

  const displayedPercent = (c: ChannelAllocation) => channelEdits[c.id] ?? c.percent;
  const channelSum = allocationSum(data.channels.map((c) => ({ ...c, percent: displayedPercent(c) })));
  const hasPendingChannelEdits = Object.keys(channelEdits).length > 0;

  const handleChannelInput = (c: ChannelAllocation, value: string) => {
    const n = Math.max(0, Math.min(100, Number(value) || 0));
    setChannelEdits((prev) => ({ ...prev, [c.id]: n }));
  };

  const handleNormalizeChannels = () => {
    const changes = Object.entries(channelEdits).map(([channelId, allocation]) => ({ channelId, allocation }));
    onApplyAction({ type: 'reallocate_budget', rationale: t.strategy.manualBudgetEditRationale, channelChanges: changes });
    setChannelEdits({});
  };

  const startFunnelEdit = (stageId: string, currentRate: number | undefined) => {
    setEditingFunnelId(stageId);
    setFunnelDraft(String(currentRate ?? 0));
  };

  const commitFunnelEdit = (stageId: string) => {
    const rate = Math.max(0, Math.min(100, Number(funnelDraft) || 0));
    onApplyAction({ type: 'update_funnel_rate', funnelStageId: stageId, newRate: rate });
    setEditingFunnelId(null);
  };

  return (
    <div className="strategy-grid">
      <div className="strategy-card strategy-card-score">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.scoreTitle}</span>
        </div>
        <div className="strategy-score-main">
          <div className="strategy-score-number">{overall}</div>
          <div className="strategy-score-suffix">/100</div>
          <div className="strategy-score-badge">{scoreLabel(t, overall)}</div>
        </div>
        <div className="strategy-score-bars">
          {SCORE_METRICS.map((m) => (
            <div key={m.key} className="strategy-score-bar-row">
              <span className="strategy-score-bar-label">{m.label}</span>
              <span className="strategy-score-bar-track">
                <span className="strategy-score-bar-fill" style={{ width: `${data.scoreBreakdown[m.key]}%` }} />
              </span>
              <span className="strategy-score-bar-value">{data.scoreBreakdown[m.key]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-goal">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.goalCardTitle}</span>
        </div>
        <div className="strategy-goal-value">{STRATEGY_GOAL_LABELS[brief.goal][language]}</div>
        <p className="strategy-card-text strategy-goal-summary">{data.goalSummary}</p>
        <div className="strategy-goal-meta">
          {brief.market} · {brief.durationMonths} {t.strategy.months} · {brief.budget.toLocaleString('ru-RU')} {brief.currency}
        </div>
      </div>

      <div className="strategy-card strategy-card-audience">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.audienceCardTitle}</span>
          <span className="strategy-card-subtitle">
            {data.audience.length} {t.strategy.segmentsUnit}
          </span>
        </div>
        <div className="strategy-audience-list">
          {data.audience.map((seg) => (
            <div key={seg.id} className="strategy-audience-row-card">
              <div className="strategy-audience-card-top">
                <span className="strategy-audience-name">{seg.name}</span>
                <span className={`strategy-potential-badge strategy-potential-${seg.potential.toLowerCase()}`}>
                  {seg.potential} {t.strategy.potentialLabel}
                </span>
              </div>
              <p className="strategy-audience-desc">{seg.mainJob}</p>
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

      <div className="strategy-card strategy-card-positioning">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.positioningCardTitle}</span>
        </div>
        <p className="strategy-card-text">{data.positioning.primaryStatement}</p>
        {data.positioning.alternatives.length > 0 && (
          <div className="strategy-alt-chip-list">
            {data.positioning.alternatives.map((alt) => (
              <button
                key={alt.id}
                type="button"
                className="strategy-alt-chip"
                onClick={() =>
                  onApplyAction({
                    type: 'set_primary_positioning',
                    positioningAlternativeId: alt.id,
                    rationale: t.strategy.manualPositioningRationale,
                  })
                }
                title={alt.statement}
              >
                {alt.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="strategy-card-link-btn" onClick={onOpenOffer}>
          {t.strategy.openBtn}
        </button>
      </div>

      <div className="strategy-card strategy-card-offer">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.offerCardTitle}</span>
          <button
            type="button"
            className="strategy-icon-link-btn"
            disabled={generatingOffers}
            onClick={onGenerateOfferAlternatives}
            title={t.strategy.generateAlternativesBtn}
          >
            <IconSparkles size={13} />
          </button>
        </div>
        <p className="strategy-card-text">{offer?.text}</p>
        {alternativeOffers.length > 0 && (
          <div className="strategy-offer-alt-list">
            {alternativeOffers.map((alt) => (
              <div key={alt.id} className="strategy-offer-alt-row">
                <span className="strategy-offer-alt-text">{alt.text}</span>
                <button
                  type="button"
                  className="strategy-icon-link-btn"
                  title={t.strategy.setPrimaryBtn}
                  onClick={() => onApplyAction({ type: 'set_primary_offer', offerId: alt.id, rationale: t.strategy.manualOfferRationale })}
                >
                  <IconCheck size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {generatingOffers && <div className="strategy-inline-loading">{t.strategy.generatingOffers}</div>}
      </div>

      <div className="strategy-card strategy-card-channels">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.channelsCardTitle}</span>
          {hasPendingChannelEdits && (
            <span className={`strategy-normalize-hint ${channelSum !== 100 ? 'warn' : ''}`}>
              {channelSum}% ·{' '}
              <button type="button" className="strategy-inline-link" onClick={handleNormalizeChannels}>
                {t.strategy.normalizeBtn}
              </button>
            </span>
          )}
        </div>
        <div className="strategy-channel-bars">
          {data.channels.map((c) => {
            const forecast = computeChannelForecast(brief.budget, c);
            return (
              <div key={c.id} className="strategy-channel-row">
                <div className="strategy-channel-top">
                  <button type="button" className="strategy-channel-name-btn" onClick={() => onOpenChannel(c)}>
                    {c.name}
                  </button>
                  <input
                    className="strategy-channel-percent-input"
                    type="number"
                    min={0}
                    max={100}
                    value={displayedPercent(c)}
                    onChange={(e) => handleChannelInput(c, e.target.value)}
                  />
                  <span className="strategy-channel-percent-sign">%</span>
                  <span className="strategy-channel-budget">
                    {forecast.spend.toLocaleString('ru-RU')} {brief.currency}
                  </span>
                </div>
                <span className="strategy-channel-track">
                  <span className="strategy-channel-fill" style={{ width: `${displayedPercent(c)}%` }} />
                </span>
                <div className="strategy-channel-forecast">
                  {forecast.insufficientData
                    ? t.strategy.forecastInsufficientData
                    : `${forecast.clicksMin?.toLocaleString('ru-RU')}–${forecast.clicksMax?.toLocaleString('ru-RU')} ${t.strategy.forecastClicks}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="strategy-card strategy-card-risks">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.risksCardTitle}</span>
          <span className="strategy-card-subtitle">{activeRisks.length}</span>
        </div>
        <div className="strategy-note-list">
          {activeRisks.map((r) => (
            <div key={r.id} className="strategy-note strategy-note-risk">
              <span className="strategy-note-icon">!</span>
              <div className="strategy-note-body">
                <div className="strategy-note-title">{r.title}</div>
                <div className="strategy-note-desc">{r.description}</div>
                <div className="strategy-note-actions">
                  <button
                    type="button"
                    className="strategy-inline-link"
                    onClick={() =>
                      onApplyAction(r.action ?? { type: 'apply_risk', insightId: r.id, rationale: r.evidence })
                    }
                  >
                    {t.strategy.fixBtn}
                  </button>
                  <button
                    type="button"
                    className="strategy-inline-link muted"
                    onClick={() => onApplyAction({ type: 'dismiss_insight', insightId: r.id })}
                  >
                    {t.strategy.dismissBtn}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {activeRisks.length === 0 && <div className="strategy-empty-hint">{t.strategy.noActiveRisks}</div>}
        </div>
      </div>

      <div className="strategy-card strategy-card-opportunities">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.opportunitiesCardTitle}</span>
          <span className="strategy-card-subtitle">{activeOpportunities.length}</span>
        </div>
        <div className="strategy-note-list">
          {activeOpportunities.map((o) => (
            <div key={o.id} className="strategy-note strategy-note-opportunity">
              <span className="strategy-note-icon">↑</span>
              <div className="strategy-note-body">
                <div className="strategy-note-title">{o.title}</div>
                <div className="strategy-note-desc">{o.description}</div>
                <div className="strategy-note-actions">
                  <button
                    type="button"
                    className="strategy-inline-link"
                    onClick={() =>
                      onApplyAction(o.action ?? { type: 'apply_opportunity', insightId: o.id, rationale: o.evidence })
                    }
                  >
                    {t.strategy.assistantApply}
                  </button>
                  <button
                    type="button"
                    className="strategy-inline-link muted"
                    onClick={() => onApplyAction({ type: 'dismiss_insight', insightId: o.id })}
                  >
                    {t.strategy.dismissBtn}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {activeOpportunities.length === 0 && <div className="strategy-empty-hint">{t.strategy.noActiveOpportunities}</div>}
        </div>
      </div>

      <div className="strategy-card strategy-card-kpi">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.kpiCardTitle}</span>
        </div>
        <div className="strategy-kpi-list">
          {data.kpis.map((k) => (
            <div key={k.id} className="strategy-kpi-row">
              <span className="strategy-kpi-label">{k.label}</span>
              <span className="strategy-kpi-value">
                {k.target} <span className="strategy-kpi-unit">{k.unit}</span>
              </span>
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
            <div key={row.id} className="strategy-matrix-row">
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
            <div key={stage.id} className="strategy-funnel-stage">
              <div className="strategy-funnel-value">{stage.volume.toLocaleString('ru-RU')}</div>
              <div className="strategy-funnel-label">{stage.label}</div>
              {i < data.funnel.length - 1 && stage.conversionToNext !== undefined && (
                <div className="strategy-funnel-connector">
                  <span className="strategy-funnel-connector-line" />
                  {editingFunnelId === stage.id ? (
                    <input
                      autoFocus
                      className="strategy-funnel-rate-input"
                      type="number"
                      min={0}
                      max={100}
                      value={funnelDraft}
                      onChange={(e) => setFunnelDraft(e.target.value)}
                      onBlur={() => commitFunnelEdit(stage.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitFunnelEdit(stage.id);
                        if (e.key === 'Escape') setEditingFunnelId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="strategy-funnel-connector-value"
                      onClick={() => startFunnelEdit(stage.id, stage.conversionToNext)}
                    >
                      {stage.conversionToNext}%
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card strategy-card-journey">
        <div className="strategy-card-header">
          <span className="strategy-card-title">{t.strategy.journeyCardTitle}</span>
        </div>
        <div className="strategy-journey-flow">
          {JOURNEY_ORDER.map((key) => {
            const step = data.journey.find((j) => j.stage === key);
            return (
              <div key={key} className="strategy-journey-step">
                <div className="strategy-journey-stage-label">{JOURNEY_LABELS[key]}</div>
                {step && (
                  <>
                    <div className="strategy-journey-thought">«{step.customerThought}»</div>
                    <div className="strategy-journey-meta">{step.channel}</div>
                    <div className="strategy-journey-meta">{step.content}</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
