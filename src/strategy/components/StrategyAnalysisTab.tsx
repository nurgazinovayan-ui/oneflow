import { useT } from '../../i18n';
import type { ChannelHypothesis, StrategyV4 } from '../domain/types';
import { ConfidenceBadge, EvidenceTypeBadge } from './EvidenceBadge';
import { GuardrailEngine } from '../domain/calculators';
import LandingAuditCard from './LandingAuditCard';

function ChannelGate({ channel }: { channel: ChannelHypothesis }) {
  // No live ad-platform connector in this build, so every input the gate needs is conservatively
  // "not yet known" — this deliberately keeps both gates closed by default (spec §70), rather
  // than inventing a plausible "yes you can scale" out of nothing.
  const scaleGate = GuardrailEngine.evaluateScaleGate({
    reachedTargetKpi: false,
    meaningfulContribution: false,
    headroomStatus: channel.headroomStatus,
    dominatedByWarmAudience: false,
    hasDeteriorationRiskNote: false,
    hasReviewWindow: false,
    hasSpendCap: false,
  });
  const pauseGate = GuardrailEngine.evaluatePauseGate({
    sufficientSpendOrVolume: false,
    outOfLearningPhase: false,
    isPrimaryConversionSource: false,
    confirmedByMultipleSignals: false,
  });
  return (
    <div className="channel-gate">
      <span className={`channel-gate-tag ${scaleGate.allowed ? 'open' : 'closed'}`} title={scaleGate.reasons.join('; ')}>
        Scale gate: {scaleGate.allowed ? 'open' : 'closed'}
      </span>
      <span className={`channel-gate-tag ${pauseGate.allowed ? 'open' : 'closed'}`} title={pauseGate.reasons.join('; ')}>
        Pause gate: {pauseGate.allowed ? 'open' : 'closed'}
      </span>
    </div>
  );
}

// "Анализ" — professional mode (spec §35): evidence-backed detail behind every simple-mode claim.
export default function StrategyAnalysisTab({ strategy }: { strategy: StrategyV4 }) {
  const t = useT();

  return (
    <div className="strategy-analysis-tab">
      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisSegmentsTitle}</div>
        <table className="analysis-table">
          <tbody>
            {strategy.segments.map((s) => (
              <tr key={s.id}>
                <td className="analysis-table-name">{s.name}</td>
                <td>{s.priority}</td>
                <td>{s.buyingSituation}</td>
                <td>
                  <ConfidenceBadge level={s.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisJtbdTitle}</div>
        {strategy.jtbd.map((j) => (
          <div key={j.id} className="analysis-jtbd-item">
            «{j.situation} — {j.motivation}, {j.desiredOutcome}, но {j.anxieties}»
          </div>
        ))}
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisPositioningTitle}</div>
        {strategy.positioningOptions.map((p) => (
          <div key={p.id} className={`analysis-positioning-item ${p.isPrimary ? 'primary' : ''}`}>
            <div className="analysis-item-header">
              <span>{p.style}</span>
              {p.isPrimary && <span className="analysis-primary-tag">primary</span>}
            </div>
            <div>{p.value}</div>
            <div className="analysis-item-sub">vs {p.alternative} — {p.reasonToBelieve}</div>
          </div>
        ))}
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisOffersTitle}</div>
        {strategy.offers.map((o) => (
          <div key={o.id} className={`analysis-offer-item ${o.isPrimary ? 'primary' : ''}`}>
            <div className="analysis-item-header">
              <span>{o.motive}</span>
              <EvidenceTypeBadge type={o.evidenceType} />
              <ConfidenceBadge level={o.confidence} />
            </div>
            <div>{o.promise}</div>
            <div className="analysis-item-sub">{o.mechanism}</div>
          </div>
        ))}
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisChannelsTitle}</div>
        {strategy.channels.map((c) => (
          <div key={c.id} className="analysis-channel-item">
            <div className="analysis-item-header">
              <span>{c.channel}</span>
              <span className="analysis-headroom">{c.headroomStatus}</span>
              <ConfidenceBadge level={c.confidence} />
            </div>
            <div className="analysis-item-sub">{c.role}</div>
            <div className="analysis-item-sub">scale: {c.scaleCriteria.join('; ') || '—'}</div>
            <div className="analysis-item-sub">pause: {c.pauseCriteria.join('; ') || '—'}</div>
            <ChannelGate channel={c} />
          </div>
        ))}
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisCreativeTitle}</div>
        {strategy.creativeCards.map((c) => (
          <div key={c.id} className="analysis-creative-item">
            <div className="analysis-item-header">
              <span>{c.archetype}</span>
              <span className="analysis-status-tag">{c.status}</span>
            </div>
            <div className="creative-card-layer">
              <div className="creative-card-layer-label">Content</div>
              <div className="analysis-item-sub">hook: {c.content.hook}</div>
              <div className="analysis-item-sub">
                format: {c.content.visualFormat} · persona: {c.content.persona} · stage: {c.content.intentStage}
              </div>
            </div>
            <div className="creative-card-layer">
              <div className="creative-card-layer-label">Performance</div>
              {c.performance.ctr === undefined && c.performance.cpa === undefined ? (
                <div className="analysis-item-sub">not observable: {c.performance.notObservable.join(', ')}</div>
              ) : (
                <div className="analysis-item-sub">
                  CTR {c.performance.ctr ?? '—'} · CPA {c.performance.cpa ?? '—'} · fatigue: {c.performance.fatigueSignal}
                </div>
              )}
            </div>
            <div className="creative-card-layer">
              <div className="creative-card-layer-label">Learning</div>
              <div className="analysis-item-sub">{c.learning.winnerPattern ?? '—'}</div>
            </div>
          </div>
        ))}
      </div>

      <LandingAuditCard strategy={strategy} />

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisFunnelTitle}</div>
        <div className="analysis-funnel-row">
          {strategy.funnel.map((step) => (
            <div key={step.key} className="analysis-funnel-step">
              <div className="analysis-funnel-label">{step.label}</div>
              <div className="analysis-funnel-value">{step.volume ?? '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisEconomicsTitle}</div>
        <table className="analysis-table">
          <tbody>
            {Object.entries(strategy.economics).map(([key, metric]) => (
              <tr key={key}>
                <td className="analysis-table-name">{key.toUpperCase()}</td>
                <td>{metric.value !== undefined ? metric.value.toFixed(2) : '—'}</td>
                <td className="analysis-item-sub">{metric.formula}</td>
                <td className="analysis-item-sub">{metric.missingInputs.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="strategy-card plan-card">
        <div className="strategy-card-title">{t.strategy.analysisHistoryTitle}</div>
        <div className="analysis-history-list">
          {strategy.history
            .slice()
            .reverse()
            .map((h) => (
              <div key={h.id} className="analysis-history-item">
                <span className="analysis-history-time">{new Date(h.timestamp).toLocaleString()}</span> {h.description}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
