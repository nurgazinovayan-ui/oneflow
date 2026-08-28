import { useEffect, useRef, useState } from 'react';
import { IconSend } from './Icons';
import { useT } from '../i18n';
import type { OnlineUser } from '../types';

const ONLINE_POLL_INTERVAL_MS = 15_000;

interface AdminSendMessageModalProps {
  onClose: () => void;
}

function formatLastSeen(
  lastSeen: string,
  t: { lastSeenJustNow: string; lastSeenMinutesAgo: (n: number) => string }
): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(lastSeen).getTime()) / 60_000));
  return minutes < 1 ? t.lastSeenJustNow : t.lastSeenMinutesAgo(minutes);
}

export default function AdminSendMessageModal({ onClose }: AdminSendMessageModalProps) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[] | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const users = await window.api.getOnlineUsers();
        if (!cancelled) setOnlineUsers(users);
      } catch {
        if (!cancelled) setOnlineUsers((prev) => prev ?? []);
      }
    };
    void poll();
    intervalRef.current = window.setInterval(poll, ONLINE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const handleSend = async () => {
    if (!email.trim() || !message.trim() || status === 'sending') return;
    setStatus('sending');
    setError(undefined);
    const result = await window.api.sendAdminMessage(email.trim(), message.trim());
    if (result.ok) {
      setStatus('sent');
      setMessage('');
      setTimeout(() => setStatus('idle'), 1500);
    } else {
      setStatus('error');
      setError(result.error || t.adminModal.genericError);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          <IconSend /> {t.adminModal.title}
        </h2>
        <p className="modal-hint">{t.adminModal.hint}</p>

        <label className="field-label">{t.adminModal.onlineTitle}</label>
        <div className="admin-online-list">
          {onlineUsers === null ? (
            <div className="connected-hint">{t.adminModal.onlineLoading}</div>
          ) : onlineUsers.length === 0 ? (
            <div className="connected-hint">{t.adminModal.onlineEmpty}</div>
          ) : (
            onlineUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                className={`admin-online-row ${email.trim().toLowerCase() === u.email.toLowerCase() ? 'active' : ''}`}
                onClick={() => setEmail(u.email)}
              >
                <span className="admin-online-dot" />
                <span className="admin-online-email">{u.email}</span>
                <span className="admin-online-time">{formatLastSeen(u.lastSeen, t.adminModal)}</span>
              </button>
            ))
          )}
        </div>

        <label className="field-label">{t.adminModal.emailLabel}</label>
        <input
          className="node-select"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="field-label">{t.adminModal.messageLabel}</label>
        <textarea
          className="node-textarea"
          placeholder={t.adminModal.messagePlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
        />

        {status === 'error' && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            {t.adminModal.close}
          </button>
          <button
            className="generate-btn"
            onClick={handleSend}
            disabled={!email.trim() || !message.trim() || status === 'sending'}
          >
            {status === 'sending' ? t.adminModal.sending : status === 'sent' ? t.adminModal.sent : t.adminModal.send}
          </button>
        </div>
      </div>
    </div>
  );
}
