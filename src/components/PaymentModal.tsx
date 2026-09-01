import { useState } from 'react';
import { IconCheck, IconClose } from './Icons';
import Prism from './Prism';
import { useT } from '../i18n';

interface PaymentModalProps {
  checkoutUrl: string;
  onClose: () => void;
  onRecheck: () => Promise<boolean>;
}

interface Tier {
  key: string;
  title: string;
  price: string;
  benefits: string[];
  buttonLabel: string;
  onSelect: (() => void) | null;
  accent?: boolean;
}

// Pricing overview, opened from the "Тариф" button in the top toolbar (always shown, including
// demo mode — this reads as a general "view pricing" entry point rather than strictly an
// unpaid-account nag). Only the Популярный/Максимальный tiers actually lead anywhere — both
// currently open the same single checkoutUrl (see webApi.ts buildCheckoutUrl), since the backend
// only has one LemonSqueezy product wired up so far; per-tier checkout links would need separate
// LemonSqueezy variants configured before this can charge different amounts.
export default function PaymentModal({ checkoutUrl, onClose, onRecheck }: PaymentModalProps) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);

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
      key: 'basic',
      title: t.paymentModal.tierBasicTitle,
      price: t.paymentModal.freeLabel,
      benefits: [t.paymentModal.benefitOneflowAccess, t.paymentModal.benefitBudgetChoice],
      buttonLabel: t.paymentModal.currentPlanBtn,
      onSelect: null,
    },
    {
      key: 'popular',
      title: t.paymentModal.tierPopularTitle,
      price: '$20',
      benefits: popularBenefits,
      buttonLabel: t.paymentModal.selectBtn,
      onSelect: handlePay,
      accent: true,
    },
    {
      key: 'max',
      title: t.paymentModal.tierMaxTitle,
      price: '$70',
      benefits: [...popularBenefits, t.paymentModal.benefitUnlimitedBudget, t.paymentModal.benefitPrioritySupport],
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
        <h2 className="pricing-heading">{t.paymentModal.heading}</h2>
        <p className="pricing-subheading">{t.paymentModal.subheading}</p>
        <div className="pricing-grid">
          {tiers.map((tier) => (
            <div key={tier.key} className={`pricing-card ${tier.accent ? 'accent' : ''}`}>
              <div className="pricing-card-bg">
                <Prism animationType="rotate" hueShift={0} glow={1} bloom={1} noise={0} scale={3.2} />
              </div>
              <div className="pricing-card-content">
                <span className="pricing-price">{tier.price}</span>
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
          ))}
        </div>
        {notFound && <div className="error-text pricing-error">{t.paymentModal.paymentNotFound}</div>}
        <button className="pricing-recheck-link" onClick={handleRecheck} disabled={checking}>
          {checking ? t.paymentModal.checkingBtn : t.paymentModal.recheckLink}
        </button>
      </div>
    </div>
  );
}
