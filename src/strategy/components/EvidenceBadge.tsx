import { useT } from '../../i18n';
import type { ConfidenceLevel, Evidence, EvidenceType } from '../domain/types';

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const t = useT();
  const label = level === 'high' ? t.strategy.confidenceHigh : level === 'medium' ? t.strategy.confidenceMedium : t.strategy.confidenceLow;
  return <span className={`confidence-badge confidence-${level}`}>{label}</span>;
}

export function EvidenceTypeBadge({ type }: { type: EvidenceType }) {
  const t = useT();
  const label = {
    fact: t.strategy.evidenceTypeFact,
    research: t.strategy.evidenceTypeResearch,
    hypothesis: t.strategy.evidenceTypeHypothesis,
    unknown: t.strategy.evidenceTypeUnknown,
  }[type];
  return <span className={`evidence-type-badge evidence-type-${type}`}>{label}</span>;
}

export function WhyButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="strategy-inline-link why-btn" onClick={onClick}>
      {t.strategy.whyBtn}
    </button>
  );
}

export interface EvidenceDrawerTarget {
  title: string;
  confidence: ConfidenceLevel;
  evidence: Evidence[];
  missingData: string[];
  howToVerify?: string;
}

export function EvidenceDrawer({ target, onClose }: { target: EvidenceDrawerTarget; onClose: () => void }) {
  const t = useT();
  return (
    <div className="strategy-drawer-overlay" onClick={onClose}>
      <div className="strategy-drawer evidence-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="strategy-drawer-header">
          <div className="strategy-drawer-title">{t.strategy.evidenceDrawerTitle}</div>
          <button type="button" className="strategy-drawer-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="strategy-drawer-subtitle">{target.title}</div>
        <div className="evidence-drawer-section">
          <div className="strategy-drawer-label">{t.strategy.evidenceDrawerConfidenceLabel}</div>
          <ConfidenceBadge level={target.confidence} />
        </div>
        <div className="evidence-drawer-section">
          {target.evidence.length === 0 ? (
            <div className="evidence-drawer-empty">{t.strategy.evidenceDrawerEmpty}</div>
          ) : (
            <ul className="evidence-drawer-list">
              {target.evidence.map((e) => (
                <li key={e.id} className="evidence-drawer-item">
                  <EvidenceTypeBadge type={e.type} />
                  <span>{e.statement}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {target.missingData.length > 0 && (
          <div className="evidence-drawer-section">
            <div className="strategy-drawer-label">{t.strategy.evidenceDrawerMissingDataLabel}</div>
            <ul className="evidence-drawer-list">
              {target.missingData.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {target.howToVerify && (
          <div className="evidence-drawer-section">
            <div className="strategy-drawer-label">{t.strategy.evidenceDrawerHowToVerifyLabel}</div>
            <div>{target.howToVerify}</div>
          </div>
        )}
      </div>
    </div>
  );
}
