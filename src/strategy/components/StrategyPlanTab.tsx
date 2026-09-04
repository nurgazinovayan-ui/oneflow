import { useState } from 'react';
import { useT } from '../../i18n';
import type { StrategyV4 } from '../domain/types';
import { ConfidenceBadge, EvidenceDrawer, WhyButton, type EvidenceDrawerTarget } from './EvidenceBadge';
import { evidenceByIds } from '../domain/types';

// "Ваш план" — the simple-mode executive plan (spec §27-34). Every block ends with a concrete
// next action; professional detail (evidence graph, funnel, economics) lives in the Analysis tab.
export default function StrategyPlanTab({ strategy }: { strategy: StrategyV4 }) {
  const t = useT();
  const [drawerTarget, setDrawerTarget] = useState<EvidenceDrawerTarget | null>(null);

  const bu = strategy.businessUnderstanding;
  const topSegment = strategy.segments.find((s) => s.priority === 'now') ?? strategy.segments[0];
  const positioning = strategy.positioningOptions.find((p) => p.isPrimary) ?? strategy.positioningOptions[0];
  const offer = strategy.offers.find((o) => o.isPrimary) ?? strategy.offers[0];

  return (
    <div className="strategy-plan-tab">
      {bu && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title">{t.strategy.planBusinessTitle}</div>
          <div className="plan-business-grid">
            <div>
              <div className="plan-field-label">{t.strategy.businessConfirmProductLabel}</div>
              <div>{bu.product}</div>
            </div>
            <div>
              <div className="plan-field-label">{t.strategy.businessConfirmValueLabel}</div>
              <div>{bu.value}</div>
            </div>
            <div>
              <div className="plan-field-label">{t.strategy.businessConfirmTodayLabel}</div>
              <div>{bu.solvesTodayVia}</div>
            </div>
            <div>
              <div className="plan-field-label">{t.strategy.businessConfirmRiskLabel}</div>
              <div>{bu.mainPurchaseRisk}</div>
            </div>
          </div>
        </div>
      )}

      {topSegment && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title-row">
            <div className="strategy-card-title">{t.strategy.planAudienceTitle}</div>
            <ConfidenceBadge level={topSegment.confidence} />
          </div>
          <div className="plan-audience-name">{topSegment.name}</div>
          <ul className="plan-bullet-list">
            <li>{topSegment.buyingSituation}</li>
            <li>{topSegment.urgencyTrigger}</li>
            <li>{topSegment.productFit}</li>
          </ul>
          <WhyButton
            onClick={() =>
              setDrawerTarget({
                title: topSegment.name,
                confidence: topSegment.confidence,
                evidence: evidenceByIds(strategy, topSegment.evidenceIds),
                missingData: topSegment.assumptions,
              })
            }
          />
        </div>
      )}

      {(positioning || offer) && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title">{t.strategy.planMessageTitle}</div>
          {positioning && <div className="plan-message-main">{positioning.value}</div>}
          {offer && <div className="plan-message-support">{offer.promise}</div>}
          {offer?.proof && <div className="plan-message-proof">{offer.proof}</div>}
        </div>
      )}

      {offer && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title-row">
            <div className="strategy-card-title">{t.strategy.planOfferTitle}</div>
            <ConfidenceBadge level={offer.confidence} />
          </div>
          <div className="plan-offer-promise">{offer.promise}</div>
          <div className="plan-field-label">{offer.mechanism}</div>
          <div className="plan-offer-cta">{offer.cta}</div>
        </div>
      )}

      {strategy.channels.length > 0 && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title">{t.strategy.planChannelsTitle}</div>
          <table className="plan-channels-table">
            <tbody>
              {strategy.channels.map((c) => (
                <tr key={c.id}>
                  <td className="plan-channel-name">{c.channel}</td>
                  <td>{c.role}</td>
                  <td>{c.whyTest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {strategy.creativeCards.length > 0 && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title">{t.strategy.planCreativeTitle}</div>
          <div className="plan-creative-grid">
            {strategy.creativeCards.map((c) => (
              <div key={c.id} className="plan-creative-item">
                <div className="plan-creative-hook">{c.content.hook}</div>
                <div className="plan-creative-format">{c.archetype}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {strategy.actionPlan.length > 0 && (
        <div className="strategy-card plan-card">
          <div className="strategy-card-title">{t.strategy.planActionTitle}</div>
          <div className="plan-action-list">
            {strategy.actionPlan.map((task) => (
              <div key={task.id} className="plan-action-item">
                <div className="plan-action-week">Неделя {task.week}</div>
                <div className="plan-action-body">
                  <div className="plan-action-goal">{task.goal}</div>
                  <div>{task.action}</div>
                  <div className="plan-action-result">→ {task.expectedResult}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {strategy.readiness.nextStepLabel && (
        <div className="strategy-card plan-card plan-next-step-card">
          <div className="strategy-card-title">{t.strategy.planNextStepTitle}</div>
          <div className="plan-next-step-label">{strategy.readiness.nextStepLabel}</div>
        </div>
      )}

      {drawerTarget && <EvidenceDrawer target={drawerTarget} onClose={() => setDrawerTarget(null)} />}
    </div>
  );
}
