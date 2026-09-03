import { IconClose, IconRocket } from './Icons';
import type { AudienceSegment, ChannelAllocation, StrategyData } from '../strategyTypes';
import { useT } from '../i18n';

export type StrategyDetailTarget =
  | { kind: 'audience'; segment: AudienceSegment }
  | { kind: 'channel'; channel: ChannelAllocation }
  | { kind: 'offer' };

interface StrategyDetailDrawerProps {
  target: StrategyDetailTarget;
  data: StrategyData;
  onClose: () => void;
  onCreate: (target: StrategyDetailTarget) => void;
}

// Right drawer per spec section 25 — used instead of a separate screen when opening an
// Audience/Offer/Channel card's details.
export default function StrategyDetailDrawer({ target, data, onClose, onCreate }: StrategyDetailDrawerProps) {
  const t = useT();
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
                <div className="strategy-drawer-field-value">{target.segment.description}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerPainPoints}</div>
                <ul className="strategy-drawer-list">
                  {target.segment.painPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.drawerOffer}</div>
                <div className="strategy-drawer-field-value">{data.offer}</div>
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
                <div className="strategy-drawer-field-value">{data.positioning}</div>
              </div>
              <div className="strategy-drawer-field">
                <div className="strategy-drawer-field-label">{t.strategy.offerCardTitle}</div>
                <div className="strategy-drawer-field-value">{data.offer}</div>
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
