import { useEffect, useState } from 'react';
import { IconCheck, IconClose } from './Icons';
import Prism from './Prism';
import { useT } from '../i18n';
import type { LegalDoc } from '../legalContent';

interface PaymentModalProps {
  onClose: () => void;
  onRecheck: () => Promise<boolean>;
  onOpenLegal: (doc: LegalDoc) => void;
}

type CrystalStyle = 'glow' | 'dim' | 'full';
type BillingPeriod = 'month' | 'year';

interface Tier {
  key: string;
  title: string;
  priceMonth: string;
  priceYear: string;
  yearlyDiscount: string | null;
  benefits: string[];
  buttonLabel: string;
  onSelect: (() => void) | null;
  accent?: boolean;
  crystal: CrystalStyle;
}

// Pricing overview, opened from the "Тариф" button in the top toolbar (shown in demo mode and
// to real users without an active subscription; hidden once a real user has one — see App.tsx's
// isDemoMode/subscriptionActive gate). Real checkout isn't wired up for end users yet, so
// "Оформить" always shows the "in development" toast rather than opening LemonSqueezy — see
// handlePay below.
export default function PaymentModal({ onClose, onRecheck, onOpenLegal }: PaymentModalProps) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('month');
  const [toastVisible, setToastVisible] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getCreditBalance()
      .then((balance) => {
        if (!cancelled) setBalanceUsd(balance);
      })
      .catch(() => {
        // No balance to show (e.g. logged out) — leave the line hidden rather than erroring.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePay = () => {
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
      priceMonth: t.paymentModal.freeLabel,
      priceYear: t.paymentModal.freeLabel,
      yearlyDiscount: null,
      benefits: [t.paymentModal.benefitOneflowAccess, t.paymentModal.benefitBudgetChoice],
      buttonLabel: t.paymentModal.currentPlanBtn,
      onSelect: null,
      crystal: 'glow',
    },
    {
      key: 'popular',
      title: t.paymentModal.tierPopularTitle,
      priceMonth: '$60',
      priceYear: '$600',
      yearlyDiscount: '-20%',
      benefits: popularBenefits,
      buttonLabel: t.paymentModal.selectBtn,
      onSelect: handlePay,
      accent: true,
      crystal: 'dim',
    },
    {
      key: 'max',
      title: t.paymentModal.tierMaxTitle,
      priceMonth: '$200',
      priceYear: '$1800',
      yearlyDiscount: '-20%',
      benefits: [...popularBenefits, t.paymentModal.benefitPrioritySupport],
      buttonLabel: t.paymentModal.selectBtn,
      onSelect: handlePay,
      crystal: 'full',
    },
  ];

  return (
    <div className="modal-overlay pricing-overlay" onClick={onClose}>
      <div className="pricing-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pricing-close" onClick={onClose}>
          <IconClose size={16} />
        </button>
        <h2 className="pricing-heading">{t.paymentModal.heading}</h2>
        <p className="pricing-subheading">{t.paymentModal.subheading}</p>
        {Number.isFinite(balanceUsd) && (
          <p className="pricing-balance">
            {t.paymentModal.balanceLabel} ${(balanceUsd as number).toFixed(2)}
          </p>
        )}

        <div className="pricing-period-toggle">
          <button
            className={period === 'month' ? 'active' : ''}
            onClick={() => setPeriod('month')}
          >
            {t.paymentModal.periodMonth}
          </button>
          <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>
            {t.paymentModal.periodYear}
          </button>
        </div>

        <div className="pricing-grid">
          {tiers.map((tier) => {
            const price = period === 'month' ? tier.priceMonth : tier.priceYear;
            const showDiscount = period === 'year' && tier.yearlyDiscount;
            return (
              <div key={tier.key} className={`pricing-card ${tier.accent ? 'accent' : ''}`}>
                <div className="pricing-card-bg">
                  {tier.crystal === 'glow' && <div className="pricing-card-glow" />}
                  {tier.crystal === 'dim' && (
                    <>
                      <Prism
                        animationType="rotate"
                        glow={0.35}
                        bloom={0.4}
                        noise={0}
                        scale={3.2}
                        offset={{ x: -35, y: 0 }}
                      />
                      <Prism
                        animationType="rotate"
                        glow={0.35}
                        bloom={0.4}
                        noise={0}
                        scale={3.2}
                        offset={{ x: 35, y: 0 }}
                      />
                    </>
                  )}
                  {tier.crystal === 'full' && (
                    <Prism animationType="rotate" glow={1} bloom={1} noise={0} scale={3.2} />
                  )}
                </div>
                <div className="pricing-card-content">
                  <div className="pricing-price-row">
                    {showDiscount && <span className="pricing-discount-badge">{tier.yearlyDiscount}</span>}
                    <span className="pricing-price">{price}</span>
                  </div>
                  <h3 className="pricing-card-title">{tier.title}</h3>
                  <div className="pricing-benefits">
                    {tier.benefits.map((benefit) => (
                      <div key={benefit} className="pricing-benefit-row">
                        <IconCheck size={12} />
                        <span>{benefit}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className={`pricing-card-btn ${tier.onSelect ? '' : 'disabled'}`}
                    onClick={tier.onSelect ?? undefined}
                    disabled={!tier.onSelect}
                  >
                    {tier.buttonLabel}
                  </button>
                </div>
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
