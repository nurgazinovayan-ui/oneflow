import { useEffect, useState } from 'react';
import type { AuthStatus, SubscriptionInfo } from '../types';
import { useT } from '../i18n';

// LemonSqueezy subscription statuses: on_trial, active, paused, past_due, unpaid, cancelled,
// expired — same set ProfileModal used when the subscription badge lived there.
const ACTIVE_STATUSES = new Set(['active', 'on_trial']);

interface SubscriptionModalProps {
  onClose: () => void;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function SubscriptionModal({ onClose }: SubscriptionModalProps) {
  const t = useT();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([window.api.getAuthStatus(), window.api.getSubscriptionInfo()]).then(([auth, sub]) => {
      setAuthStatus(auth);
      setSubscription(sub);
      setLoading(false);
    });
  }, []);

  const statusLabel = subscription?.status
    ? (t.profileModal.statusLabels[subscription.status] ?? subscription.status)
    : null;
  const isActiveSub = Boolean(subscription?.status && ACTIVE_STATUSES.has(subscription.status));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.toolbarMenu.subscriptionMenuLabel}</h2>

        {loading ? (
          <p className="modal-hint">{t.profileModal.loading}</p>
        ) : (
          <div className="profile-section">
            <div className="profile-email">{authStatus?.email ?? t.profileModal.notLoggedIn}</div>
            {subscription?.configured ? (
              <div className={`profile-sub-badge ${isActiveSub ? 'active' : 'inactive'}`}>
                {statusLabel ?? t.profileModal.noSubscription}
                {subscription.currentPeriodEnd &&
                  ` · ${t.profileModal.untilDate(formatDate(subscription.currentPeriodEnd, t.profileModal.locale))}`}
              </div>
            ) : (
              <div className="profile-sub-badge muted">{t.profileModal.paymentNotConfigured}</div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="generate-btn" onClick={onClose}>
            {t.profileModal.close}
          </button>
        </div>
      </div>
    </div>
  );
}
