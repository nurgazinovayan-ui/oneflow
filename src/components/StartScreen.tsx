import { useEffect, useRef, useState } from 'react';
import { IconClose, IconSend } from './Icons';
import SideRays from './SideRays';
import { useT } from '../i18n';
import { BUSINESS_PRESET_ORDER, BUSINESS_PRESET_PROMPTS, type BusinessPresetKey } from '../businessPresets';
import type { StoredProject } from '../projectStore';

export type StartScreenChoice = 'empty' | 'photoGen' | 'photoAdapt' | 'videoGen';

interface StartScreenProps {
  onChoose: (choice: StartScreenChoice) => void;
  onChooseBusiness: (prompt: string) => void;
  onAutoCreate: (prompt: string) => Promise<void>;
  onClose: () => void;
  recentProjects: StoredProject[];
  onOpenRecent: (id: string) => void;
  onDeleteRecent: (id: string) => void;
}

type NavTab = 'recent' | 'quickStart' | 'business';

// Saved a moment ago vs. last week is the whole reason this list is ordered — an absolute
// timestamp would make the reader do that comparison themselves.
function formatAgo(timestamp: number, t: ReturnType<typeof useT>): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return t.startScreen.recentJustNow;
  if (minutes < 60) return t.startScreen.recentMinutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.startScreen.recentHours(hours);
  return t.startScreen.recentDays(Math.floor(hours / 24));
}

export default function StartScreen({
  onChoose,
  onChooseBusiness,
  onAutoCreate,
  onClose,
  recentProjects,
  onOpenRecent,
  onDeleteRecent,
}: StartScreenProps) {
  const t = useT();
  const [tab, setTab] = useState<NavTab>('quickStart');
  // Someone who already has work opens the app to continue it, not to start over — so the
  // recents tab leads once there is anything to continue. It can't be the initial state: the
  // saved projects are read from IndexedDB and land a tick or two after this first renders.
  // Once the reader has picked a tab themselves, nothing moves it under them.
  const tabChosen = useRef(false);
  useEffect(() => {
    if (!tabChosen.current && recentProjects.length > 0) setTab('recent');
  }, [recentProjects.length]);

  const selectTab = (next: NavTab) => {
    tabChosen.current = true;
    setTab(next);
  };
  // Autosave keeps the only copy of a project, so removing one is irreversible — it takes a
  // second, deliberate click rather than a single misclick on a small × .
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
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
        <SideRays />
        <button className="start-screen-close" onClick={onClose} title={t.startScreen.closeTooltip}>
          <IconClose size={14} />
        </button>
        <div className="start-screen-video-panel">
          <video
            className="start-screen-video"
            src="/start-screen-video.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        </div>
        <div className="start-screen-main">
          <h1 className="start-screen-title">{t.startScreen.greeting}</h1>
          <div className="start-screen-layout">
            <div className="start-screen-sidebar">
              {recentProjects.length > 0 && (
                <button
                  className={`start-screen-nav-item ${tab === 'recent' ? 'active' : ''}`}
                  onClick={() => selectTab('recent')}
                >
                  {t.startScreen.recentNav}
                </button>
              )}
              <button
                className={`start-screen-nav-item ${tab === 'quickStart' ? 'active' : ''}`}
                onClick={() => selectTab('quickStart')}
              >
                {t.startScreen.quickStartNav}
              </button>
              <button
                className={`start-screen-nav-item ${tab === 'business' ? 'active' : ''}`}
                onClick={() => selectTab('business')}
              >
                {t.startScreen.businessNav}
              </button>
            </div>
            <div className="start-screen-content">
              {tab === 'recent' && (
                <div className="start-screen-recents">
                  {recentProjects.map((project) => (
                    <div key={project.id} className="start-screen-recent">
                      <button className="start-screen-recent-open" onClick={() => onOpenRecent(project.id)}>
                        <span className="start-screen-recent-name">{project.name}</span>
                        <span className="start-screen-recent-meta">
                          {t.startScreen.recentNodes(project.nodes.length)} · {formatAgo(project.updatedAt, t)}
                        </span>
                      </button>
                      {confirmDelete === project.id ? (
                        <button
                          className="start-screen-recent-delete confirming"
                          onClick={() => {
                            onDeleteRecent(project.id);
                            setConfirmDelete(null);
                          }}
                          onMouseLeave={() => setConfirmDelete(null)}
                        >
                          {t.startScreen.recentDeleteConfirm}
                        </button>
                      ) : (
                        <button
                          className="start-screen-recent-delete"
                          title={t.startScreen.recentDelete}
                          onClick={() => setConfirmDelete(project.id)}
                        >
                          <IconClose size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="start-screen-recent-hint">{t.startScreen.recentHint}</p>
                </div>
              )}
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
    </div>
  );
}
