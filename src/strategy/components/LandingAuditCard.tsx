import { useState } from 'react';
import type { StrategyV4 } from '../domain/types';
import { classifyMessageMatch } from '../domain/landingAudit';
import { useStrategyStore } from '../state/strategyStore';

const STATUS_LABEL: Record<string, string> = {
  match: 'Совпадает',
  partial: 'Частично совпадает',
  mismatch: 'Не совпадает',
  not_checked: 'Не проверено',
};

/** spec §75-76 — Landing Page Message Match. Manual entry; the match/mismatch call is still deterministic. */
export default function LandingAuditCard({ strategy }: { strategy: StrategyV4 }) {
  const updateStrategy = useStrategyStore((s) => s.updateStrategy);
  const offer = strategy.offers.find((o) => o.isPrimary) ?? strategy.offers[0];
  const [adPromise, setAdPromise] = useState(strategy.landingAudit?.adPromise ?? offer?.promise ?? '');
  const [headline, setHeadline] = useState(strategy.landingAudit?.landingHeadline ?? '');
  const [aboveFold, setAboveFold] = useState(strategy.landingAudit?.landingAboveFold ?? '');

  const runCheck = () => {
    const status = classifyMessageMatch(adPromise, headline, aboveFold);
    updateStrategy((s) => ({
      ...s,
      landingAudit: { adPromise, landingHeadline: headline, landingAboveFold: aboveFold, status, notes: '', checkedAt: Date.now() },
    }));
  };

  return (
    <div className="strategy-card plan-card landing-audit-card">
      <div className="strategy-card-title-row">
        <div className="strategy-card-title">Landing Page Message Match</div>
        {strategy.landingAudit && (
          <span className={`landing-audit-status landing-audit-${strategy.landingAudit.status}`}>
            {STATUS_LABEL[strategy.landingAudit.status]}
          </span>
        )}
      </div>
      <div className="landing-audit-fields">
        <label>
          Ad promise
          <input className="node-select" value={adPromise} onChange={(e) => setAdPromise(e.target.value)} />
        </label>
        <label>
          Landing H1
          <input className="node-select" value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </label>
        <label>
          Above-the-fold value prop
          <input className="node-select" value={aboveFold} onChange={(e) => setAboveFold(e.target.value)} />
        </label>
      </div>
      <button type="button" className="secondary-btn" onClick={runCheck}>
        Проверить соответствие
      </button>
    </div>
  );
}
