import { useEffect, useState } from 'react';
import type { ArchiveEntry } from '../types';
import { IconFolderOpen, IconImage, IconVideo, IconCrop, IconVector } from './Icons';
import { useT } from '../i18n';

const POLL_INTERVAL_MS = 5000;

interface ArchiveStripProps {
  projectId: string;
}

function categoryIcon(category: ArchiveEntry['category']) {
  if (category === 'video') return <IconVideo size={12} />;
  if (category === 'adapt') return <IconCrop size={12} />;
  if (category === 'vector') return <IconVector size={12} />;
  return <IconImage size={12} />;
}

export default function ArchiveStrip({ projectId }: ArchiveStripProps) {
  const t = useT();
  const categoryLabel = (category: ArchiveEntry['category']) => t.profileModal.categoryLabels[category];
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.api.listArchive(projectId).then((list) => {
        if (!cancelled) setEntries(list);
      });
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  return (
    <div className="archive-strip">
      <div className="archive-strip-header">
        <span className="archive-strip-title">{t.archive.title(entries.length)}</span>
        <button
          className="archive-strip-open-btn"
          onClick={() => window.api.openArchiveFolder(projectId)}
        >
          <IconFolderOpen size={13} /> {t.archive.openFolder}
        </button>
      </div>
      <div className="archive-strip-items">
        {entries.length === 0 && <div className="archive-strip-empty">{t.archive.empty}</div>}
        {entries.map((entry) => (
          <div key={entry.fileName} className="archive-item" title={entry.fileName}>
            {entry.category === 'video' ? (
              <video src={entry.url} className="archive-item-thumb" muted />
            ) : (
              <img src={entry.url} alt={entry.fileName} className="archive-item-thumb" />
            )}
            <span className="archive-item-badge">
              {categoryIcon(entry.category)} {categoryLabel(entry.category)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
