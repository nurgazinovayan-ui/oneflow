import { useEffect, useRef, useState } from 'react';
import { useT, useLanguageStore } from '../i18n';
import { LEGAL_CONTENT, type LegalDoc } from '../legalContent';
import '../Consent.css';

export type ConsentPurpose = 'register' | 'google' | 'payment' | 'required';

interface ConsentModalProps {
  purpose: ConsentPurpose;
  // Records the acceptance (server side where there is one); a throw keeps the window open with
  // an error. Error message 'legal_outdated' means the server expects a newer edition.
  onAccept: () => Promise<void> | void;
  // Cancel (register/payment) or log out (required): the action that needed consent doesn't happen.
  onCancel: () => void;
}

// The Terms of Service and the Privacy Policy, readable in full right in the window, with a separate
// checkbox for each: sign-up, payment and (for accounts that haven't accepted the current edition)
// the app itself don't go on until both are ticked and the acceptance is saved.
export default function ConsentModal({ purpose, onAccept, onCancel }: ConsentModalProps) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const tabs: LegalDoc[] = purpose === 'payment' ? ['terms', 'privacy', 'refund'] : ['terms', 'privacy'];
  const [tab, setTab] = useState<LegalDoc>('terms');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const doc = LEGAL_CONTENT[language][tab];
  const lead = { register: t.legalConsent.leadRegister, google: t.legalConsent.leadGoogle, payment: t.legalConsent.leadPayment, required: t.legalConsent.leadRequired }[purpose];
  const tabLabel = (d: LegalDoc) => (d === 'terms' ? t.legalConsent.termsTab : d === 'privacy' ? t.legalConsent.privacyTab : t.legalConsent.refundLink);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    // Esc backs out of sign-up/payment; the required window has no "close" — only accept or log out
    if (purpose === 'required') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [purpose, busy, onCancel]);

  const accept = async () => {
    if (!terms || !privacy) {
      setError(t.legalConsent.mustAccept);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onAccept();
    } catch (e) {
      setError(e instanceof Error && e.message === 'legal_outdated' ? t.legalConsent.outdated : t.legalConsent.saveError);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay consent-overlay">
      <div className="consent" role="dialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-lead">
        <h2 id="consent-title">{t.legalConsent.title}</h2>
        <p id="consent-lead" className="consent-lead">
          {lead}
        </p>

        <div className="consent-tabs" role="tablist" aria-label={t.legalConsent.title}>
          {tabs.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              id={`consent-tab-${d}`}
              aria-selected={tab === d}
              aria-controls="consent-doc"
              className={tab === d ? 'on' : ''}
              onClick={() => setTab(d)}
            >
              {tabLabel(d)}
            </button>
          ))}
        </div>
        <div className="consent-doc" id="consent-doc" role="tabpanel" aria-labelledby={`consent-tab-${tab}`} ref={scrollRef} tabIndex={0}>
          <h3>{doc.title}</h3>
          <p className="consent-updated">{doc.updated}</p>
          <p>{doc.intro}</p>
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h4>{section.heading}</h4>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>

        <label className="consent-check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} disabled={busy} />
          <span>{t.legalConsent.acceptTerms}</span>
        </label>
        <label className="consent-check">
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} disabled={busy} />
          <span>{t.legalConsent.acceptPrivacy}</span>
        </label>
        {purpose === 'payment' && (
          <p className="consent-refund">
            {t.legalConsent.refundNote}{' '}
            <button type="button" onClick={() => setTab('refund')}>
              {t.legalConsent.refundLink}
            </button>
          </p>
        )}

        {error && (
          <p className="consent-error" role="alert">
            {error}
          </p>
        )}

        <div className="consent-actions">
          <button type="button" className="consent-cancel" onClick={onCancel} disabled={busy}>
            {purpose === 'required' ? t.legalConsent.logout : t.legalConsent.cancel}
          </button>
          <button type="button" className="consent-accept" onClick={accept} disabled={busy || !terms || !privacy}>
            {busy ? t.legalConsent.accepting : t.legalConsent.accept}
          </button>
        </div>
        <p className="consent-foot">{t.legalConsent.required}</p>
      </div>
    </div>
  );
}
