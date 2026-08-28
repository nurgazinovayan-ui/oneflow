import { useEffect, useState } from 'react';
import { IconSave } from './Icons';
import type { AuthStatus } from '../types';
import { useT } from '../i18n';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const t = useT();
  const [apiKey, setApiKey] = useState('');
  const [generationLimit, setGenerationLimit] = useState('50');
  const [saved, setSaved] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    window.api.getApiKey().then(setApiKey);
    window.api.getUsage().then((u) => setGenerationLimit(String(u.limit)));
    window.api.getAuthStatus().then(setAuthStatus);
  }, []);

  const handleLogout = () => {
    window.api.logout();
  };

  const handleSave = async () => {
    await window.api.setApiKey(apiKey.trim());
    const limit = Number(generationLimit);
    if (limit > 0) await window.api.setGenerationLimit(Math.round(limit * 100) / 100);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.settingsModal.title}</h2>

        {authStatus?.configured && (
          <>
            <label className="field-label">{t.settingsModal.account}</label>
            <div className="account-row">
              <span className="connected-hint">{authStatus.email ?? '—'}</span>
              <button className="secondary-btn" onClick={handleLogout}>
                {t.settingsModal.logout}
              </button>
            </div>
          </>
        )}

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
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            {t.settingsModal.close}
          </button>
          <button className="generate-btn" onClick={handleSave}>
            <IconSave /> {saved ? t.settingsModal.saved : t.settingsModal.save}
          </button>
        </div>
      </div>
    </div>
  );
}
