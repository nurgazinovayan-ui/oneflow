import { useState } from 'react';
import LegalModal from './LegalModal';
import type { LegalDoc } from '../legalContent';
import { readConsent, setConsent } from '../analytics';
import { useT } from '../i18n';

// Asks before analytics gets to store anything on the visitor's device.
//
// Until this is answered PostHog runs in memory-only mode (see analytics.ts): the current tab is
// measured, nothing is written to storage, no device id survives a reload. So the banner is a
// real gate rather than the decorative kind that tracks you while it asks.
//
// It renders nothing at all when analytics isn't configured for the deployment, which keeps a
// self-hosted or key-less build free of a banner that would promise something it never does.
export default function ConsentBanner() {
  const t = useT();
  const configured = Boolean(import.meta.env.VITE_POSTHOG_KEY);
  const [answered, setAnswered] = useState(() => readConsent() !== null);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);

  if (!configured || answered) return null;

  const answer = (choice: 'accepted' | 'declined') => {
    setConsent(choice);
    setAnswered(true);
  };

  return (
    <>
      <div className="consent-banner" role="dialog" aria-label={t.consent.title}>
        <p className="consent-banner-text">
          {t.consent.text}{' '}
          <button className="consent-banner-link" onClick={() => setLegalDoc('privacy')}>
            {t.consent.policyLink}
          </button>
        </p>
        <div className="consent-banner-actions">
          <button className="consent-banner-btn" onClick={() => answer('declined')}>
            {t.consent.decline}
          </button>
          <button className="consent-banner-btn primary" onClick={() => answer('accepted')}>
            {t.consent.accept}
          </button>
        </div>
      </div>
      {legalDoc && <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}
    </>
  );
}
