import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSend, IconGauge, IconClose } from './Icons';
import { useT } from '../i18n';
import type { OnlineUser, AdminGenerationRecord } from '../types';

const ONLINE_POLL_INTERVAL_MS = 15_000;

type Tab = 'messages' | 'stats';

interface AdminPanelProps {
  onClose: () => void;
}

function formatLastSeen(
  lastSeen: string,
  t: { lastSeenJustNow: string; lastSeenMinutesAgo: (n: number) => string }
): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(lastSeen).getTime()) / 60_000));
  return minutes < 1 ? t.lastSeenJustNow : t.lastSeenMinutesAgo(minutes);
}

// Owner-only (nurgazinov.ayan@gmail.com — see App.tsx's ADMIN_EMAIL gate on the toolbar button
// that opens this). Two tabs: broadcast/targeted messages to any user (existing feature,
// extended here from single-recipient to "everyone" or a multi-select), and a read-only view
// of @mechta.kz accounts' generation activity (new — server-side filtered to that domain in
// admin-list-generations, not just hidden client-side).
export default function AdminPanel({ onClose }: AdminPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('messages');

  const [broadcast, setBroadcast] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [sentCount, setSentCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[] | null>(null);
  const intervalRef = useRef<number | null>(null);

  const [stats, setStats] = useState<AdminGenerationRecord[] | null>(null);
  const [statsError, setStatsError] = useState('');

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

  useEffect(() => {
    if (tab !== 'stats' || stats !== null) return;
    let cancelled = false;
    window.api
      .getMechtaGenerations()
      .then((rows) => {
        if (!cancelled) setStats(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatsError(err instanceof Error ? err.message : t.adminModal.statsError);
        setStats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, stats, t.adminModal.statsError]);

  const toggleEmail = (email: string) => {
    const key = email.toLowerCase();
    setSelectedEmails((prev) =>
      prev.some((e) => e.toLowerCase() === key) ? prev.filter((e) => e.toLowerCase() !== key) : [...prev, email]
    );
  };

  const addManualEmail = () => {
    const trimmed = emailDraft.trim();
    if (!trimmed || !trimmed.includes('@')) return;
    if (!selectedEmails.some((e) => e.toLowerCase() === trimmed.toLowerCase())) {
      setSelectedEmails((prev) => [...prev, trimmed]);
    }
    setEmailDraft('');
  };

  const handleSend = async () => {
    if (!message.trim() || status === 'sending') return;
    if (!broadcast && selectedEmails.length === 0) {
      setStatus('error');
      setError(t.adminModal.noRecipientsError);
      return;
    }
    setStatus('sending');
    setError(undefined);
    const result = await window.api.sendAdminMessage(
      broadcast ? { mode: 'all' } : { mode: 'selected', emails: selectedEmails },
      message.trim()
    );
    if (result.ok) {
      setStatus('sent');
      setSentCount(result.count ?? selectedEmails.length);
      setMessage('');
      setTimeout(() => setStatus('idle'), 2500);
    } else {
      setStatus('error');
      setError(result.error || t.adminModal.genericError);
    }
  };

  const summary = useMemo(() => {
    if (!stats) return [];
    const byEmail = new Map<string, { email: string; count: number; costUsd: number; lastAt: string }>();
    for (const row of stats) {
      const existing = byEmail.get(row.email);
      if (existing) {
        existing.count += 1;
        existing.costUsd += row.costUsd;
        if (row.createdAt > existing.lastAt) existing.lastAt = row.createdAt;
      } else {
        byEmail.set(row.email, { email: row.email, count: 1, costUsd: row.costUsd, lastAt: row.createdAt });
      }
    }
    return [...byEmail.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [stats]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-panel-modal" onClick={(e) => e.stopPropagation()}>
        <button className="admin-panel-close" onClick={onClose}>
          <IconClose size={16} />
        </button>
        <h2>{t.adminModal.title}</h2>

        <div className="admin-panel-tabs">
          <button
            className={`admin-panel-tab ${tab === 'messages' ? 'active' : ''}`}
            onClick={() => setTab('messages')}
          >
            <IconSend size={13} /> {t.adminModal.tabMessages}
          </button>
          <button className={`admin-panel-tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
            <IconGauge size={13} /> {t.adminModal.tabStats}
          </button>
        </div>

        {tab === 'messages' && (
          <>
            <p className="modal-hint">{t.adminModal.hint}</p>

            <label className="admin-broadcast-toggle">
              <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} />
              {t.adminModal.broadcastLabel}
            </label>

            {!broadcast && (
              <>
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
                        className={`admin-online-row ${
                          selectedEmails.some((e) => e.toLowerCase() === u.email.toLowerCase()) ? 'active' : ''
                        }`}
                        onClick={() => toggleEmail(u.email)}
                      >
                        <span className="admin-online-dot" />
                        <span className="admin-online-email">{u.email}</span>
                        <span className="admin-online-time">{formatLastSeen(u.lastSeen, t.adminModal)}</span>
                      </button>
                    ))
                  )}
                </div>

                <label className="field-label">{t.adminModal.recipientsLabel}</label>
                {selectedEmails.length > 0 && (
                  <div className="admin-email-chips">
                    {selectedEmails.map((email) => (
                      <span key={email} className="admin-email-chip">
                        {email}
                        <button type="button" onClick={() => toggleEmail(email)}>
                          <IconClose size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className="node-select"
                  type="email"
                  placeholder={t.adminModal.addEmailPlaceholder}
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addManualEmail();
                    }
                  }}
                />
              </>
            )}

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
                disabled={!message.trim() || status === 'sending'}
              >
                {status === 'sending'
                  ? t.adminModal.sending
                  : status === 'sent'
                    ? t.adminModal.sent(sentCount)
                    : t.adminModal.send}
              </button>
            </div>
          </>
        )}

        {tab === 'stats' && (
          <>
            <p className="modal-hint">{t.adminModal.statsHint}</p>

            {stats === null && <div className="connected-hint">{t.adminModal.statsLoading}</div>}
            {stats !== null && statsError && <div className="error-text">{statsError}</div>}
            {stats !== null && !statsError && stats.length === 0 && (
              <div className="connected-hint">{t.adminModal.statsEmpty}</div>
            )}

            {summary.length > 0 && (
              <>
                <label className="field-label">{t.adminModal.statsSummaryTitle}</label>
                <div className="admin-stats-summary">
                  {summary.map((row) => (
                    <div key={row.email} className="admin-stats-summary-row">
                      <span className="admin-stats-summary-email">{row.email}</span>
                      <span className="admin-stats-summary-count">{t.adminModal.statsGenerationsCount(row.count)}</span>
                      <span className="admin-stats-summary-cost">${row.costUsd.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <label className="field-label">{t.adminModal.statsLogTitle}</label>
                <div className="admin-stats-table-wrap">
                  <table className="admin-stats-table">
                    <thead>
                      <tr>
                        <th>{t.adminModal.statsColumnEmail}</th>
                        <th>{t.adminModal.statsColumnModel}</th>
                        <th>{t.adminModal.statsColumnCategory}</th>
                        <th>{t.adminModal.statsColumnCost}</th>
                        <th>{t.adminModal.statsColumnWhen}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats ?? []).map((row, i) => (
                        <tr key={i}>
                          <td>{row.email}</td>
                          <td>{row.model}</td>
                          <td>{row.category}</td>
                          <td>${row.costUsd.toFixed(3)}</td>
                          <td>{new Date(row.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>
                {t.adminModal.close}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
