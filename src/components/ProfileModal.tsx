import { useEffect, useMemo, useState } from 'react';
import type { AuthStatus, GenerationLogEntry } from '../types';
import { ADMIN_EMAIL } from '../types';
import type { LegalDoc } from '../legalContent';
import { IconSave, IconSend } from './Icons';
import { useGenerationCounter } from '../store/generationCounter';
import { useT, useLanguageStore, type Language } from '../i18n';
import { formatGenerationError } from '../errorMessages';

const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID as string;

interface ProfileModalProps {
  onClose: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
  onOpenAdminPanel: () => void;
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The single "Настройки" surface reached from the avatar dropdown — folds in what used to be
// three separate modals (SettingsModal's account/API-token/budget, this component's own
// stats/language/Yandex-Disk, plus entry points to the legal docs and, for the admin account,
// AdminPanel) since the toolbar only exposes one trigger for all of it now. Subscription status
// moved out to its own SubscriptionModal — "Моя подписка" is a separate dropdown item.
export default function ProfileModal({ onClose, onOpenLegal, onOpenAdminPanel }: ProfileModalProps) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [history, setHistory] = useState<GenerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSaved, setExportSaved] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [generationLimit, setGenerationLimit] = useState('50');
  const [accountSaved, setAccountSaved] = useState(false);

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInputValue(d);
  });
  const [toDate, setToDate] = useState(() => toDateInputValue(new Date()));

  const [yandexConnected, setYandexConnected] = useState(() => window.api.isYandexDiskConnected());
  const [yandexConnecting, setYandexConnecting] = useState(false);
  const [yandexCode, setYandexCode] = useState('');
  const [yandexStatus, setYandexStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [yandexError, setYandexError] = useState('');

  useEffect(() => {
    Promise.all([
      window.api.getAuthStatus(),
      window.api.getGenerationHistory(),
      window.api.getApiKey(),
      window.api.getUsage(),
    ]).then(([auth, hist, key, usage]) => {
      setAuthStatus(auth);
      setHistory(hist);
      setApiKey(key);
      setGenerationLimit(String(usage.limit));
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
    return history.filter((e) => e.timestamp >= fromMs && e.timestamp <= toMs);
  }, [history, fromDate, toDate]);

  const byModel = useMemo(() => {
    const map = new Map<string, { count: number; costUsd: number }>();
    for (const entry of filtered) {
      const cur = map.get(entry.model) ?? { count: 0, costUsd: 0 };
      cur.count += 1;
      cur.costUsd += entry.costUsd;
      map.set(entry.model, cur);
    }
    return Array.from(map.entries())
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  const totalCount = filtered.length;
  const totalCost = filtered.reduce((sum, e) => sum + e.costUsd, 0);

  const handleLogout = () => {
    window.api.logout();
  };

  const handleAccountSave = async () => {
    await window.api.setApiKey(apiKey.trim());
    const limit = Number(generationLimit);
    if (limit > 0) await window.api.setGenerationLimit(Math.round(limit * 100) / 100);
    setAccountSaved(true);
    setTimeout(() => setAccountSaved(false), 1500);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportSaved(false);
    try {
      const header = `${t.profileModal.csvHeader}\n`;
      const rows = filtered
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((e) => {
          const d = new Date(e.timestamp);
          const date = d.toLocaleDateString(t.profileModal.locale);
          const time = d.toLocaleTimeString(t.profileModal.locale);
          const category = t.profileModal.categoryLabels[e.category] ?? e.category;
          return `${date},${time},${e.model},${category},${e.costUsd.toFixed(4)}`;
        })
        .join('\n');
      const csv = header + rows;
      const dataUrl = `data:text/csv;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(csv)))}`;
      const savedPath = await window.api.saveFile(
        dataUrl,
        `oneflow-generations-${fromDate}_${toDate}.csv`
      );
      if (savedPath) {
        setExportSaved(true);
        setTimeout(() => setExportSaved(false), 2000);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t.profileModal.exportError);
    } finally {
      setExporting(false);
    }
  };

  const startYandexConnect = () => {
    window.open(
      `https://oauth.yandex.ru/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}`,
      '_blank',
      'noopener,noreferrer'
    );
    setYandexConnecting(true);
    setYandexStatus('idle');
    setYandexError('');
  };

  const submitYandexCode = async () => {
    if (!yandexCode.trim()) {
      setYandexStatus('error');
      setYandexError(t.yandexDisk.noCodeError);
      return;
    }
    setYandexStatus('loading');
    setYandexError('');
    try {
      await window.api.connectYandexDisk(yandexCode.trim());
      setYandexConnected(true);
      setYandexConnecting(false);
      setYandexCode('');
      setYandexStatus('idle');
    } catch (err) {
      setYandexStatus('error');
      setYandexError(formatGenerationError(err));
    }
  };

  const disconnectYandex = () => {
    window.api.disconnectYandexDisk();
    setYandexConnected(false);
  };

  const sessionGenerationCount = useGenerationCounter((s) => s.count);
  const isAdmin = authStatus?.email === ADMIN_EMAIL;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.settingsModal.title}</h2>

        {loading ? (
          <p className="modal-hint">{t.profileModal.loading}</p>
        ) : (
          <>
            <label className="field-label">{t.settingsModal.account}</label>
            <div className="account-row">
              <span className="connected-hint">{authStatus?.email ?? t.profileModal.notLoggedIn}</span>
              <button className="secondary-btn" onClick={handleLogout}>
                {t.settingsModal.logout}
              </button>
            </div>
            <div className="profile-session-count">
              {t.profileModal.sessionGenerations(sessionGenerationCount)}
            </div>

            {import.meta.env.VITE_WEB_MODE !== '1' && (
              <>
                <label className="field-label">{t.settingsModal.apiToken}</label>
                <input
                  type="password"
                  className="node-select"
                  value={apiKey}
                  placeholder="r8_..."
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <p className="modal-hint">{t.settingsModal.apiTokenHint}</p>
              </>
            )}

            <label className="field-label">{t.settingsModal.budgetLimit}</label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              className="node-select"
              value={generationLimit}
              onChange={(e) => setGenerationLimit(e.target.value)}
            />
            <p className="modal-hint">{t.settingsModal.budgetHint}</p>
            <button className="secondary-btn" onClick={handleAccountSave}>
              <IconSave /> {accountSaved ? t.settingsModal.saved : t.settingsModal.save}
            </button>

            <label className="field-label">{t.profileModal.periodLabel}</label>
            <div className="profile-date-range">
              <input
                type="date"
                className="node-select"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span>—</span>
              <input
                type="date"
                className="node-select"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="profile-totals">
              {t.profileModal.totalLabel(totalCount, `$${totalCost.toFixed(2)}`)}
            </div>

            <div className="profile-model-list">
              {byModel.length === 0 && (
                <div className="connected-hint">{t.profileModal.emptyPeriod}</div>
              )}
              {byModel.map((m) => (
                <div key={m.model} className="profile-model-row">
                  <span className="profile-model-name">{m.model}</span>
                  <span className="profile-model-count">{m.count}</span>
                  <span className="profile-model-cost">${m.costUsd.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <button
              className="secondary-btn"
              disabled={filtered.length === 0 || exporting}
              onClick={handleExport}
            >
              <IconSave />{' '}
              {exporting
                ? t.profileModal.exportPreparing
                : exportSaved
                  ? t.profileModal.exportSaved
                  : t.profileModal.exportBtn}
            </button>
            {exportError && <div className="error-text">{exportError}</div>}

            <label className="field-label">{t.profileModal.preferencesTitle}</label>
            <div className="profile-preferences">
              <div className="profile-preference-row">
                <span className="profile-preference-label">{t.profileModal.languageLabel}</span>
                <div className="segmented-control">
                  <button
                    className={language === 'ru' ? 'active' : ''}
                    onClick={() => setLanguage('ru' as Language)}
                  >
                    Русский
                  </button>
                  <button
                    className={language === 'en' ? 'active' : ''}
                    onClick={() => setLanguage('en' as Language)}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>

            {import.meta.env.VITE_WEB_MODE === '1' && (
              <>
                <label className="field-label">{t.yandexDisk.title}</label>
                <div className="yandex-disk-section">
                  <p className="modal-hint">{t.yandexDisk.description}</p>
                  {yandexConnected ? (
                    <div className="yandex-disk-connected-row">
                      <span className="profile-sub-badge active">{t.yandexDisk.connectedLabel}</span>
                      <button className="secondary-btn" onClick={disconnectYandex}>
                        {t.yandexDisk.disconnectBtn}
                      </button>
                    </div>
                  ) : yandexConnecting ? (
                    <div className="yandex-disk-code-row">
                      <input
                        type="text"
                        className="node-select"
                        value={yandexCode}
                        onChange={(e) => setYandexCode(e.target.value)}
                        placeholder={t.yandexDisk.codePlaceholder}
                      />
                      <button
                        className="generate-btn"
                        onClick={submitYandexCode}
                        disabled={yandexStatus === 'loading'}
                      >
                        {yandexStatus === 'loading' ? t.yandexDisk.submittingBtn : t.yandexDisk.submitBtn}
                      </button>
                    </div>
                  ) : (
                    <button className="secondary-btn" onClick={startYandexConnect}>
                      {t.yandexDisk.connectBtn}
                    </button>
                  )}
                  {yandexStatus === 'error' && <div className="error-text">{yandexError}</div>}
                </div>
              </>
            )}

            <label className="field-label">{t.profileModal.legalSectionTitle}</label>
            <div className="profile-legal-links">
              <button type="button" className="secondary-btn" onClick={() => onOpenLegal('privacy')}>
                {t.legal.privacyLink}
              </button>
              <button type="button" className="secondary-btn" onClick={() => onOpenLegal('terms')}>
                {t.legal.termsLink}
              </button>
              <button type="button" className="secondary-btn" onClick={() => onOpenLegal('refund')}>
                {t.legal.refundLink}
              </button>
              <button type="button" className="secondary-btn" onClick={() => onOpenLegal('help')}>
                {t.legal.helpLink}
              </button>
            </div>

            {isAdmin && (
              <>
                <label className="field-label">{t.adminModal.title}</label>
                <button type="button" className="secondary-btn" onClick={onOpenAdminPanel}>
                  <IconSend /> {t.adminModal.title}
                </button>
              </>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="generate-btn" onClick={onClose}>
            {t.settingsModal.close}
          </button>
        </div>
      </div>
    </div>
  );
}
