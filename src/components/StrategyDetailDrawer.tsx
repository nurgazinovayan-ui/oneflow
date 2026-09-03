import { IconClose, IconRocket } from './Icons';
import type { AudienceSegment, ChannelAllocation, StrategyData } from '../strategyTypes';
import { primaryOffer } from '../strategyTypes';
import { computeChannelForecast } from '../strategyCompute';
import { useT } from '../i18n';

export type StrategyDetailTarget =
  | { kind: 'audience'; segment: AudienceSegment }
  | { kind: 'channel'; channel: ChannelAllocation }
  | { kind: 'offer' };

interface StrategyDetailDrawerProps {
  target: StrategyDetailTarget;
  data: StrategyData;
  budget: number;
  onClose: () => void;
  onCreate: (target: StrategyDetailTarget) => void;
}

// Right drawer per spec section 25 — used instead of a separate screen when opening an
// Audience/Offer/Channel card's details.
export default function StrategyDetailDrawer({ target, data, budget, onClose, onCreate }: StrategyDetailDrawerProps) {
  const t = useT();
  const offer = primaryOffer(data.offers);
  return (
    <div className="strategy-drawer-overlay" onClick={onClose}>
      <div className="strategy-drawer" onClick={(e) => e.stopPropagation()}>
        {target.kind === 'audience' && (
          <>
            <div className="strategy-drawer-header">
              <span>{target.segment.name}</span>
              <button className="evaluation-slot-remove" onClick={onClose}>
                <IconClose size={14} />
              </button>
            </div>
            <div className="strategy-drawer-body">
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerPotential}</div>
                <div className="strategy-drawer-field-value">{target.segment.potential}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerMainJob}</div>
                <div className="strategy-drawer-field-value">{target.segment.mainJob || target.segment.description}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerPainPoints}</div>
                <ul className="strategy-drawer-list">
                  {target.segment.painPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
              {target.segment.purchaseTriggers.length > 0 && (
                <div className="strategy-drawer-field">
                  <div className="strategy-drawer-field-label">{t.strategy.drawerTriggers}</div>
                  <ul className="strategy-drawer-list">
                    {target.segment.purchaseTriggers.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {target.segment.objections.length > 0 && (
                <div className="strategy-drawer-field">
                  <div className="strategy-drawer-field-label">{t.strategy.drawerObjections}</div>
                  <ul className="strategy-drawer-list">
                    {target.segment.objections.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerOffer}</div>
                <div className="strategy-drawer-field-value">{target.segment.recommendedMessage || offer?.text}</div>
              </div>
              <div className="strategy-drawer-confidence">
                {t.strategy.drawerConfidence}: {target.segment.confidence}%
              </div>
            </div>
          </>
        )}

        {target.kind === 'channel' && (
          <>
            <div className="strategy-drawer-header">
              <span>{target.channel.name}</span>
              <button className="evaluation-slot-remove" onClick={onClose}>
                <IconClose size={14} />
              </button>
            </div>
            <div className="strategy-drawer-body">
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerAllocation}</div>
                <div className="strategy-drawer-field-value">{target.channel.percent}%</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerRationale}</div>
                <div className="strategy-drawer-field-value">{target.channel.rationale}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerForecast}</div>
                <div className="strategy-drawer-field-value">
                  {(() => {
                    const f = computeChannelForecast(budget, target.channel);
                    return f.insufficientData
                      ? t.strategy.forecastInsufficientData
                      : `${f.clicksMin?.toLocaleString('ru-RU')}–${f.clicksMax?.toLocaleString('ru-RU')} ${t.strategy.forecastClicks}`;
                  })()}
                </div>
              </div>
              <div className="strategy-drawer-confidence">
                {t.strategy.drawerConfidence}: {target.channel.confidence}%
              </div>
            </div>
          </>
        )}

        {target.kind === 'offer' && (
          <>
            <div className="strategy-drawer-header">
              <span>{t.strategy.offerCardTitle}</span>
              <button className="evaluation-slot-remove" onClick={onClose}>
                <IconClose size={14} />
              </button>
            </div>
            <div className="strategy-drawer-body">
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.positioningCardTitle}</div>
                <div className="strategy-drawer-field-value">{data.positioning.primaryStatement}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerValueProp}</div>
                <div className="strategy-drawer-field-value">{data.positioning.valueProposition}</div>
              </div>
              {data.positioning.reasonsToBelieve.length > 0 && (
                <div className="strategy-drawer-field">
                  <div className="strategy-drawer-field-label">{t.strategy.drawerReasonsToBelieve}</div>
                  <ul className="strategy-drawer-list">
                    {data.positioning.reasonsToBelieve.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.offerCardTitle}</div>
                <div className="strategy-drawer-field-value">{offer?.text}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerAngle}</div>
                <div className="strategy-drawer-field-value">{offer?.angle}</div>
              </div>
            </div>
          </>
        )}

        {target.kind !== 'channel' && (
          <div className="strategy-drawer-actions">
            <button type="button" className="generate-btn" onClick={() => onCreate(target)}>
              <IconRocket size={13} /> {t.strategy.createOfferBtn}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
