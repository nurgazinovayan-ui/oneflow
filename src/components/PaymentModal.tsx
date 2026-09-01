import { useState } from 'react';
import { IconCheck, IconClose } from './Icons';
import Prism from './Prism';
import { useT } from '../i18n';

interface PaymentModalProps {
  checkoutUrl: string;
  onClose: () => void;
  onRecheck: () => Promise<boolean>;
}

type CrystalStyle = 'glow' | 'small' | 'full';
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

// Pricing overview, opened from the "Тариф" button in the top toolbar (always shown, including
// demo mode — this reads as a general "view pricing" entry point rather than strictly an
// unpaid-account nag). Only the Популярный/Максимальный tiers actually lead anywhere — both
// currently open the same single checkoutUrl (see webApi.ts buildCheckoutUrl), since the backend
// only has one LemonSqueezy product wired up so far; per-tier checkout links would need separate
// LemonSqueezy variants configured before this can charge different amounts (monthly vs. yearly
// included — the toggle below only changes what's displayed, not which checkout link opens).
export default function PaymentModal({ checkoutUrl, onClose, onRecheck }: PaymentModalProps) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('month');

  const handlePay = () => {
    if (checkoutUrl) window.api.openCheckout(checkoutUrl);
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
      crystal: 'small',
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
                  {tier.crystal === 'small' && (
                    <div className="pricing-card-bg-small">
                      <Prism
                        animationType="rotate"
                        glow={0.8}
                        bloom={0.9}
                        noise={0}
                        scale={3.2}
                        offset={{ x: -18, y: 0 }}
                      />
                      <Prism
                        animationType="rotate"
                        glow={0.8}
                        bloom={0.9}
                        noise={0}
                        scale={3.2}
                        offset={{ x: 18, y: 0 }}
                      />
                    </div>
                  )}
                  {tier.crystal === 'full' && (
                    <Prism animationType="rotate" glow={1} bloom={1} noise={0} scale={3.2} />
                  )}
                </div>
                <div className="pricing-card-content">
                  {showDiscount && <span className="pricing-discount-badge">{tier.yearlyDiscount}</span>}
                  <span className="pricing-price">{price}</span>
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
      </div>
    </div>
  );
}
