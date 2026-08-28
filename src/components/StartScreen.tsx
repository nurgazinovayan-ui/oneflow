import { useState } from 'react';
import { IconSend } from './Icons';
import { useT } from '../i18n';
import { BUSINESS_PRESET_ORDER, BUSINESS_PRESET_PROMPTS, type BusinessPresetKey } from '../businessPresets';

export type StartScreenChoice = 'empty' | 'photoGen' | 'photoAdapt' | 'videoGen';

interface StartScreenProps {
  onChoose: (choice: StartScreenChoice) => void;
  onChooseBusiness: (prompt: string) => void;
  onAutoCreate: (prompt: string) => Promise<void>;
}

type NavTab = 'quickStart' | 'business';

export default function StartScreen({ onChoose, onChooseBusiness, onAutoCreate }: StartScreenProps) {
  const t = useT();
  const [tab, setTab] = useState<NavTab>('quickStart');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const quickTiles: { key: StartScreenChoice; label: string; hint: string }[] = [
    { key: 'empty', label: t.startScreen.emptyDoc, hint: t.startScreen.emptyDocHint },
    { key: 'photoGen', label: t.startScreen.photoGen, hint: t.startScreen.photoGenHint },
    { key: 'photoAdapt', label: t.startScreen.photoAdapt, hint: t.startScreen.photoAdaptHint },
    { key: 'videoGen', label: t.startScreen.videoGen, hint: t.startScreen.videoGenHint },
  ];

  const businessLabels: Record<BusinessPresetKey, { label: string; hint: string }> = {
    horeca: { label: t.startScreen.businessHoreca, hint: t.startScreen.businessHorecaHint },
    auto: { label: t.startScreen.businessAuto, hint: t.startScreen.businessAutoHint },
    apartment: { label: t.startScreen.businessApartment, hint: t.startScreen.businessApartmentHint },
    furniture: { label: t.startScreen.businessFurniture, hint: t.startScreen.businessFurnitureHint },
    electronics: { label: t.startScreen.businessElectronics, hint: t.startScreen.businessElectronicsHint },
  };

  const handleSubmit = async () => {
    const prompt = draft.trim();
    if (!prompt || loading) return;
    setLoading(true);
    setError('');
    try {
      await onAutoCreate(prompt);
    } catch {
      setError(t.startScreen.autoCreateError);
      setLoading(false);
    }
  };

  return (
    <div className="start-screen">
      <div className="start-screen-inner">
        <h1 className="start-screen-title">{t.startScreen.greeting}</h1>
        <div className="start-screen-layout">
          <div className="start-screen-sidebar">
            <button
              className={`start-screen-nav-item ${tab === 'quickStart' ? 'active' : ''}`}
              onClick={() => setTab('quickStart')}
            >
              {t.startScreen.quickStartNav}
            </button>
            <button
              className={`start-screen-nav-item ${tab === 'business' ? 'active' : ''}`}
              onClick={() => setTab('business')}
            >
              {t.startScreen.businessNav}
            </button>
          </div>
          <div className="start-screen-content">
            {tab === 'quickStart' && (
              <>
                <div className="start-screen-tiles">
                  {quickTiles.map(({ key, label, hint }) => (
                    <button
                      key={key}
                      className="start-screen-tile"
                      onClick={() => onChoose(key)}
                      disabled={loading}
                    >
                      <span className="start-screen-tile-label">{label}</span>
                      <span className="start-screen-tile-hint">{hint}</span>
                    </button>
                  ))}
                </div>
                <div className="start-screen-auto">
                  <label className="field-label">{t.startScreen.autoCreateLabel}</label>
                  <div className="start-screen-auto-row">
                    <input
                      className="node-select start-screen-auto-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t.startScreen.autoCreatePlaceholder}
                      disabled={loading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleSubmit();
                        }
                      }}
                    />
                    <button
                      className="generate-btn start-screen-auto-btn"
                      onClick={() => void handleSubmit()}
                      disabled={loading || !draft.trim()}
                    >
                      <IconSend />
                    </button>
                  </div>
                  {error && <div className="error-text">{error}</div>}
                </div>
              </>
            )}
            {tab === 'business' && (
              <div className="start-screen-tiles start-screen-tiles-business">
                {BUSINESS_PRESET_ORDER.map((key) => (
                  <button
                    key={key}
                    className="start-screen-tile"
                    onClick={() => onChooseBusiness(BUSINESS_PRESET_PROMPTS[key])}
                  >
                    <span className="start-screen-tile-label">{businessLabels[key].label}</span>
                    <span className="start-screen-tile-hint">{businessLabels[key].hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
