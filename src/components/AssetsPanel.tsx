import { useEffect, useState } from 'react';
import { IconDownload, IconImage, IconVideo } from './Icons';
import type { YandexAsset } from '../types';
import { useT } from '../i18n';

interface AssetsPanelProps {
  active: boolean;
}

type Filter = 'all' | 'image' | 'video';

const NOT_CONNECTED_ERROR = 'Яндекс Диск не подключен.';

// Gallery of everything the account has saved to its Yandex Disk /ONEFLOW folder (see
// supabase/functions/yandex-list-assets) — reached via the "Ассеты" button next to BudgetBar.
// Toggled the same way as TextWorkPanel/EvaluationPanel/MusicAudioPanel etc. (always mounted,
// hidden via CSS while inactive) rather than as a separate overlay/modal, so switching to it and
// back behaves exactly like switching between any other mode. Fetches once on first activation
// rather than on mount, since most sessions never open it.
export default function AssetsPanel({ active }: AssetsPanelProps) {
  const t = useT();
  const [assets, setAssets] = useState<YandexAsset[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!active || assets !== null) return;
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
  }, [active, assets]);

  const download = (asset: YandexAsset) => {
    void window.api.saveFile(asset.url, asset.name);
  };

  const visible = (assets ?? []).filter((a) => filter === 'all' || a.mediaType === filter);
  const notConnected = error === NOT_CONNECTED_ERROR;

  return (
    <div className={`assets-panel ${active ? '' : 'assets-panel-hidden'}`}>
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
