import { useState } from 'react';
import { IconCheck } from './Icons';
import { useT } from '../i18n';

interface PaymentModalProps {
  checkoutUrl: string;
  onClose: () => void;
  onRecheck: () => Promise<boolean>;
}

export default function PaymentModal({ checkoutUrl, onClose, onRecheck }: PaymentModalProps) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const benefits = [
    t.paymentModal.benefitBudgetControl,
    t.paymentModal.benefitGenerationAssistant,
    t.paymentModal.benefitBudgetChoice,
    t.paymentModal.benefitModelsAccess,
  ];

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal payment-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.paymentModal.title}</h2>
        <div className="payment-benefits">
          {benefits.map((label) => (
            <div key={label} className="payment-benefit-row">
              <IconCheck size={14} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        {notFound && <div className="error-text">{t.paymentModal.paymentNotFound}</div>}
        <div className="modal-actions">
          <button className="secondary-btn" onClick={handleRecheck} disabled={checking}>
            {checking ? t.paymentModal.checkingBtn : t.paymentModal.recheckBtn}
          </button>
          <button className="generate-btn" onClick={handlePay}>
            {t.paymentModal.payBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
