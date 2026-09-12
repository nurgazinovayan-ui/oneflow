import { useState } from 'react';
import { IconCheck, IconClose } from './Icons';
import { useT } from '../i18n';
import type { LegalDoc } from '../legalContent';
import { capture } from '../analytics';

interface PaymentModalProps {
  onClose: () => void;
  onRecheck: () => Promise<boolean>;
  onOpenLegal: (doc: LegalDoc) => void;
}

type BillingPeriod = 'month' | 'year';

interface Tier {
  key: string;
  title: string;
  description: string;
  priceMonth: string;
  priceYear: string;
  popular: boolean;
  includesHeading: string;
  benefits: string[];
  buttonLabel: string;
  onSelect: (() => void) | null;
}

// Pricing overview, opened from the "Подписка" toolbar button, the avatar dropdown's "Моя
// подписка" item, and the Copywrite engine's plan chip. Ported 1:1 from a shadcn "pricing-section-3"
// reference (3-column tray, scaled-up dark "popular" card, pill month/year switch) onto this app's
// own CSS tokens — no Tailwind/framer-motion/lucide/NumberFlow, matching the project's existing
// design-token system. Real checkout isn't wired up for end users yet, so "Оформить" always shows
// the "in development" toast rather than opening LemonSqueezy — see handlePay below.
export default function PaymentModal({ onClose, onRecheck, onOpenLegal }: PaymentModalProps) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('month');
  const [toastVisible, setToastVisible] = useState(false);

  const handlePay = () => {
    // Deliberately not "checkout_opened": in the web build this still shows the
    // "in development" toast rather than opening LemonSqueezy, and an event named for
    // something that didn't happen is worse than no event.
    capture('plan_selected', { period });
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  };

  const handleRecheck = async () => {
    setChecking(true);
    setNotFound(false);
    const active = await onRecheck();
    setChecking(false);
    if (active) {
      onClose();
    } else {
      setNotFound(true);
    }
  };

  const popularBenefits = [
    t.paymentModal.benefitOneflowAccess,
    t.paymentModal.benefit30Models,
    t.paymentModal.benefitAiAssistant,
    t.paymentModal.benefitLlmModels,
    t.paymentModal.benefitVisualAdaptation,
    t.paymentModal.benefitOneLaunchAccess,
    t.paymentModal.benefitEvaluationAccess,
  ];

  const tiers: Tier[] = [
    {
      key: 'free',
      title: t.paymentModal.tierFreeTitle,
      description: t.paymentModal.tierFreeDesc,
      priceMonth: t.paymentModal.freeLabel,
      priceYear: t.paymentModal.freeLabel,
      popular: false,
      includesHeading: t.paymentModal.tierFreeIncludes,
      benefits: [t.paymentModal.benefitOneflowAccess, t.paymentModal.benefitBudgetChoice],
      buttonLabel: t.paymentModal.currentPlanBtn,
      onSelect: null,
    },
    {
      key: 'popular',
      title: t.paymentModal.tierPopularTitle,
      description: t.paymentModal.tierPopularDesc,
      priceMonth: '$60',
      priceYear: '$600',
      popular: true,
      includesHeading: t.paymentModal.tierPopularIncludes,
      benefits: popularBenefits,
      buttonLabel: t.paymentModal.selectBtn,
      onSelect: handlePay,
    },
    {
      key: 'max',
      title: t.paymentModal.tierMaxTitle,
      description: t.paymentModal.tierMaxDesc,
      priceMonth: '$200',
      priceYear: '$1800',
      popular: false,
      includesHeading: t.paymentModal.tierMaxIncludes,
      benefits: [...popularBenefits, t.paymentModal.benefitPrioritySupport],
      buttonLabel: t.paymentModal.selectBtn,
      onSelect: handlePay,
    },
  ];

  return (
    <div className="modal-overlay pricing-overlay" onClick={onClose}>
      <div className="pricing-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pricing-close" onClick={onClose}>
          <IconClose size={16} />
        </button>

        <div className="pricing-header">
          <div className="pricing-header-text">
            <h2 className="pricing-heading">{t.paymentModal.heading}</h2>
            <p className="pricing-subheading">{t.paymentModal.subheading}</p>
          </div>

          <div className="pricing-period-toggle">
            <span className={`pricing-toggle-slider ${period === 'year' ? 'year' : ''}`} />
            <button
              className={period === 'month' ? 'active' : ''}
              onClick={() => setPeriod('month')}
            >
              {t.paymentModal.periodMonth}
            </button>
            <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>
              {t.paymentModal.periodYear}
              <span className="pricing-save-badge">{t.paymentModal.yearlySaveBadge}</span>
            </button>
          </div>
        </div>

        <div className="pricing-grid">
          {tiers.map((tier) => {
            const price = period === 'month' ? tier.priceMonth : tier.priceYear;
            return (
              <div key={tier.key} className={`pricing-card ${tier.popular ? 'popular' : ''}`}>
                {tier.popular && <span className="pricing-popular-badge">{t.paymentModal.popularBadge}</span>}

                <div className="pricing-price-row">
                  <span className="pricing-price">{price}</span>
                  {tier.onSelect && (
                    <span className="pricing-price-period">
                      /{period === 'month' ? t.paymentModal.periodMonth : t.paymentModal.periodYear}
                    </span>
                  )}
                </div>

                <h3 className="pricing-card-title">{tier.title}</h3>
                <p className="pricing-card-desc">{tier.description}</p>

                <div className="pricing-includes">
                  <h4>{tier.includesHeading}</h4>
                  <ul>
                    {tier.benefits.map((benefit) => (
                      <li key={benefit}>
                        <span className="pricing-check-circle">
                          <IconCheck size={12} />
                        </span>
                        {benefit}
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  className={`pricing-card-btn ${tier.onSelect ? '' : 'disabled'}`}
                  onClick={tier.onSelect ?? undefined}
                  disabled={!tier.onSelect}
                >
                  {tier.buttonLabel}
                </button>
              </div>
            );
          })}
        </div>

        {notFound && <div className="error-text pricing-error">{t.paymentModal.paymentNotFound}</div>}
        <button className="pricing-recheck-link" onClick={handleRecheck} disabled={checking}>
          {checking ? t.paymentModal.checkingBtn : t.paymentModal.recheckLink}
        </button>
        <div className="pricing-legal-links">
          <button className="legal-link" onClick={() => onOpenLegal('privacy')}>
            {t.legal.privacyLink}
          </button>
          <button className="legal-link" onClick={() => onOpenLegal('terms')}>
            {t.legal.termsLink}
          </button>
          <button className="legal-link" onClick={() => onOpenLegal('refund')}>
            {t.legal.refundLink}
          </button>
        </div>
        <div className={`pricing-toast ${toastVisible ? 'visible' : ''}`}>
          {t.paymentModal.paymentInDevelopment}
        </div>
      </div>
    </div>
  );
}
