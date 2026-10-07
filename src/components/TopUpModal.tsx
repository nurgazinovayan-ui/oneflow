import { useEffect, useMemo, useState } from 'react';
import { useT, useLanguageStore } from '../i18n';
import { CREDIT_EXAMPLES, creditsForTopUp, topUpStops, useCredits } from '../credits';
import ConsentModal from './ConsentModal';

// Top-up window: a slider over sensible amounts, the credits it buys under the server's tiers
// (bigger top-ups get a better rate), and what that roughly pays for. Payment isn't connected yet
// (acquiring comes later), so the pay button explains that instead of opening a checkout; credits
// are only ever added by the server (admin grant now, the payment webhook later) — never from here.
// Payment always goes through the terms/privacy window first; its acceptance is recorded on the
// server (legal_consents, context 'payment') before anything else happens.
export default function TopUpModal() {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const { balance, topUpOpen, closeTopUp, refresh } = useCredits();
  const topup = balance?.topup ?? { minUsd: 10, maxUsd: 500, tiers: [{ fromUsd: 10, perUsd: 50 }] };
  const stops = useMemo(() => topUpStops(topup.minUsd, topup.maxUsd), [topup.minUsd, topup.maxUsd]);
  const [idx, setIdx] = useState(() => Math.max(0, stops.indexOf(50)));
  const [consentOpen, setConsentOpen] = useState(false);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (topUpOpen) void refresh();
    else setConsented(false);
  }, [topUpOpen, refresh]);

  useEffect(() => {
    if (!topUpOpen || consentOpen) return; // Esc in the consent window closes only that window
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeTopUp();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topUpOpen, consentOpen, closeTopUp]);

  if (!topUpOpen) return null;

  const usd = stops[Math.min(idx, stops.length - 1)];
  const credits = creditsForTopUp(usd, topup.tiers);
  const baseRate = topup.tiers[0]?.perUsd ?? 50;
  const rate = credits / usd;
  const bonusPct = Math.round((rate / baseRate - 1) * 100);
  const locale = language === 'en' ? 'en-US' : 'ru-RU';
  const num = (n: number) => n.toLocaleString(locale);
  const pct = (idx / Math.max(1, stops.length - 1)) * 100;
  const tierMarks = topup.tiers
    .map((tier) => ({ tier, i: stops.indexOf(tier.fromUsd) }))
    .filter((m) => m.i >= 0);
  const expiry =
    balance?.nextExpiryAt && balance.nextExpiryCredits
      ? t.credits.expires(t.credits.count(balance.nextExpiryCredits), new Date(balance.nextExpiryAt).toLocaleDateString(locale))
      : '';

  const acceptPayment = async () => {
    await window.api.acceptLegal?.('payment', { amountUsd: usd, credits });
    setConsentOpen(false);
    setConsented(true); // the checkout opens here once acquiring is connected
  };

  return (
    <>
      <div className="modal-overlay topup-overlay" onClick={closeTopUp}>
        <div className="topup" role="dialog" aria-modal="true" aria-labelledby="topup-title" onClick={(e) => e.stopPropagation()}>
          <button className="topup-close" onClick={closeTopUp} aria-label={t.credits.close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <h2 id="topup-title">{t.credits.title}</h2>
          <p className="topup-sub">{t.credits.subtitle}</p>

          <div className="topup-amount">
            <div className="topup-usd">${num(usd)}</div>
            <div className="topup-get">
              <span>{t.credits.youGet}</span>
              <b>{t.credits.count(credits)}</b>
              <div className="topup-rate">
                {t.credits.perUsd(Math.round(rate))}
                {bonusPct > 0 && <em>{t.credits.bonus(bonusPct)}</em>}
              </div>
            </div>
          </div>

          <div className="topup-slider" style={{ ['--p' as string]: `${pct}%` }}>
            <input
              type="range"
              min={0}
              max={stops.length - 1}
              step={1}
              value={idx}
              onChange={(e) => setIdx(Number(e.target.value))}
              aria-label={t.credits.title}
              aria-valuetext={`$${usd} → ${t.credits.count(credits)}`}
            />
            <div className="topup-marks" aria-hidden="true">
              <span style={{ left: '0%' }}>${num(stops[0])}</span>
              {tierMarks.slice(1).map(({ tier, i }) => (
                <span key={tier.fromUsd} className="topup-mark-tier" style={{ left: `${(i / (stops.length - 1)) * 100}%` }}>
                  ${num(tier.fromUsd)}
                  <i>+{Math.round((tier.perUsd / baseRate - 1) * 100)}%</i>
                </span>
              ))}
              <span style={{ left: '100%' }}>${num(stops[stops.length - 1])}</span>
            </div>
          </div>

          <div className="topup-approx">
            <span>{t.credits.approx}</span>
            <div className="topup-eq">
              <div>
                <b>≈ {num(Math.floor(credits / CREDIT_EXAMPLES.image))}</b>
                {t.credits.images}
              </div>
              <div>
                <b>≈ {num(Math.floor(credits / CREDIT_EXAMPLES.video5s))}</b>
                {t.credits.videos}
              </div>
              <div>
                <b>≈ {num(Math.floor(credits / CREDIT_EXAMPLES.music))}</b>
                {t.credits.music}
              </div>
            </div>
          </div>

          <div className="topup-foot">
            <div className="topup-balance">
              {balance && !balance.unlimited && <span>{t.credits.balanceNow(t.credits.count(balance.available))}</span>}
              {expiry && <span>{expiry}</span>}
              <span>{t.credits.validity}</span>
            </div>
            <button className="topup-pay" onClick={() => setConsentOpen(true)} aria-describedby="topup-pay-note">
              {t.credits.pay} · ${num(usd)}
            </button>
          </div>
          <p id="topup-pay-note" className={`topup-note${consented ? ' on' : ''}`} role={consented ? 'status' : undefined}>
            {t.credits.payNotReady}
          </p>
        </div>
      </div>
      {consentOpen && <ConsentModal purpose="payment" onAccept={acceptPayment} onCancel={() => setConsentOpen(false)} />}
    </>
  );
}
