import { useEffect, useState } from 'react';
import { IconClose, IconDownload, IconImage, IconVideo } from './Icons';
import type { YandexAsset } from '../types';
import { useT } from '../i18n';

interface AssetsPanelProps {
  onClose: () => void;
}

type Filter = 'all' | 'image' | 'video';

const NOT_CONNECTED_ERROR = 'Яндекс Диск не подключен.';

// Full-screen gallery of everything the account has saved to its Yandex Disk /ONEFLOW folder
// (see supabase/functions/yandex-list-assets) — opened from the "Ассеты" button next to
// BudgetBar. Mounted only while open (App.tsx renders it conditionally), so it always fetches a
// fresh listing on open rather than trying to keep a cache in sync with what generations get
// backed up in the background elsewhere in the app.
export default function AssetsPanel({ onClose }: AssetsPanelProps) {
  const t = useT();
  const [assets, setAssets] = useState<YandexAsset[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    window.api
      .listYandexAssets()
      .then((result) => {
        if (!cancelled) setAssets(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const download = (asset: YandexAsset) => {
    void window.api.saveFile(asset.url, asset.name);
  };

  const visible = (assets ?? []).filter((a) => filter === 'all' || a.mediaType === filter);
  const notConnected = error === NOT_CONNECTED_ERROR;

  return (
    <div className="assets-panel">
      <div className="assets-panel-header">
        <span className="assets-panel-title">{t.assets.title}</span>
        <button className="assets-panel-close" onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>
      <div className="assets-panel-body">
        <div className="assets-sidebar">
          <button
            className={`assets-sort-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t.assets.filterAll}
          </button>
          <button
            className={`assets-sort-btn ${filter === 'image' ? 'active' : ''}`}
            onClick={() => setFilter('image')}
          >
            <IconImage size={13} /> {t.assets.filterPhoto}
          </button>
          <button
            className={`assets-sort-btn ${filter === 'video' ? 'active' : ''}`}
            onClick={() => setFilter('video')}
          >
            <IconVideo size={13} /> {t.assets.filterVideo}
          </button>
        </div>

        <div className="assets-grid-area">
          {assets === null && <div className="connected-hint assets-hint">{t.assets.loadingHint}</div>}

          {assets !== null && error && (
            <div className="connected-hint assets-hint">
              {notConnected ? t.assets.notConnectedHint : t.assets.loadError}
            </div>
          )}

          {assets !== null && !error && visible.length === 0 && (
            <div className="connected-hint assets-hint">{t.assets.emptyHint}</div>
          )}

          {visible.length > 0 && (
            <div className="assets-grid">
              {visible.map((asset) => (
                <div key={asset.path} className="assets-tile">
                  {asset.mediaType === 'image' ? (
                    <img src={asset.url} alt={asset.name} loading="lazy" />
                  ) : (
                    <video src={asset.url} muted preload="metadata" />
                  )}
                  <span className="assets-tile-name">{asset.name}</span>
                  <button
                    className="assets-tile-download"
                    onClick={() => download(asset)}
                    title={t.assets.downloadTooltip}
                  >
                    <IconDownload size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
