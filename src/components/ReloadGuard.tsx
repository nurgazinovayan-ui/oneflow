import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { saveProjectToYandexDisk } from '../webApi';
import { formatGenerationError } from '../errorMessages';
import type { Node, Edge } from '@xyflow/react';

interface ReloadGuardProps {
  projectName: string;
  nodes: Node[];
  edges: Edge[];
}

// Web-only (see App.tsx) — catches F5/Ctrl+R/Cmd+R so an accidental reload doesn't silently
// drop the in-memory canvas, and offers a one-click cloud save instead of the app's normal
// "download a .json file" project save. Browsers don't allow a custom-styled beforeunload
// dialog (Chrome/Firefox/Safari all ignore a custom message and show their own generic
// "Leave site?" text with their own Leave/Cancel buttons) — that native fallback still runs
// for reload paths this can't intercept in JS (the browser's own reload button, closing the
// tab), but it can't be replaced with the two-button dialog this component renders for the
// keyboard-shortcut case, which page JS *can* fully control.
export default function ReloadGuard({ projectName, nodes, edges }: ReloadGuardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');

  const hasContent = nodes.length > 0;

  useEffect(() => {
    if (!hasContent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const isReloadShortcut = e.key === 'F5' || (mod && e.code === 'KeyR');
      if (!isReloadShortcut) return;
      e.preventDefault();
      setOpen(true);
      setError('');
      setSaved(false);
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasContent]);

  if (!open) return null;

  const handleReload = () => window.location.reload();

  const handleSave = async () => {
    if (!window.api.isYandexDiskConnected()) {
      setError(t.reloadGuard.notConnectedError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const path = await saveProjectToYandexDisk({ name: projectName, nodes, edges });
      setSaved(true);
      setSavedPath(path);
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      setError(formatGenerationError(err) || t.reloadGuard.saveError);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal reload-guard-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.reloadGuard.title}</h2>
        {error && <div className="error-text">{error}</div>}
        {saved && (
          <div className="reload-guard-saved-hint">
            {t.reloadGuard.savedHint}: {savedPath}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary-btn" onClick={handleReload} disabled={saving}>
            {t.reloadGuard.reloadBtn}
          </button>
          <button className="generate-btn" onClick={() => void handleSave()} disabled={saving || saved}>
            {saving ? t.reloadGuard.savingBtn : t.reloadGuard.saveBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
