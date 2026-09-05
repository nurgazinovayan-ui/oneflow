import { useEffect, useState } from 'react';
import { IconDownload, IconImage, IconVideo } from './Icons';
import type { YandexAsset } from '../types';
import { resolutionTierFromPixels, type ResolutionTier } from '../resolutionBadge';
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
  // Yandex's own `file` link (asset.url) doesn't reliably render cross-origin as an <img>/
  // <video> src — see NodeApi.loadYandexAsset's comment. Each tile's real bytes are fetched
  // through that proxy once assets load, keyed by path, and swapped in here as blob: URLs.
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [failedPaths, setFailedPaths] = useState<Record<string, boolean>>({});
  // Yandex Disk's listing carries no resolution metadata, so it's read off the actual decoded
  // media once each tile loads (see the badge below) rather than off the asset record itself.
  const [resolutionTiers, setResolutionTiers] = useState<Record<string, ResolutionTier>>({});

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

  useEffect(() => {
    if (!assets || assets.length === 0) return;
    let cancelled = false;
    for (const asset of assets) {
      window.api
        .loadYandexAsset(asset.path)
        .then((blobUrl) => {
          if (cancelled) return;
          setBlobUrls((prev) => ({ ...prev, [asset.path]: blobUrl }));
        })
        .catch(() => {
          if (!cancelled) setFailedPaths((prev) => ({ ...prev, [asset.path]: true }));
        });
    }
    return () => {
      cancelled = true;
    };
    // Re-run whenever the asset list itself changes (new listYandexAssets result) — assets is
    // otherwise stable within one panel session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  // Blob URLs only live for this tab's session — release them when the panel's asset list
  // changes or unmounts, rather than leaking memory for however long the page stays open.
  useEffect(() => {
    return () => {
      Object.values(blobUrls).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  const download = (asset: YandexAsset) => {
    const blobUrl = blobUrls[asset.path];
    if (blobUrl) void window.api.saveFile(blobUrl, asset.name);
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
              {notConnected ? t.assets.notConnectedHint : `${t.assets.loadError} (${error})`}
            </div>
          )}

          {assets !== null && !error && visible.length === 0 && (
            <div className="connected-hint assets-hint">{t.assets.emptyHint}</div>
          )}

          {visible.length > 0 && (
            <div className="assets-grid">
              {visible.map((asset) => {
                const blobUrl = blobUrls[asset.path];
                const failed = failedPaths[asset.path];
                return (
                  <div key={asset.path} className="assets-tile">
                    {failed ? (
                      <div className="assets-tile-error">{t.assets.tileLoadError}</div>
                    ) : blobUrl ? (
                      asset.mediaType === 'image' ? (
                        <img
                          src={blobUrl}
                          alt={asset.name}
                          onLoad={(e) => {
                            const el = e.currentTarget;
                            setResolutionTiers((prev) => ({
                              ...prev,
                              [asset.path]: resolutionTierFromPixels(Math.max(el.naturalWidth, el.naturalHeight)),
                            }));
                          }}
                        />
                      ) : (
                        <video
                          src={blobUrl}
                          muted
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const el = e.currentTarget;
                            setResolutionTiers((prev) => ({
                              ...prev,
                              [asset.path]: resolutionTierFromPixels(Math.max(el.videoWidth, el.videoHeight)),
                            }));
                          }}
                        />
                      )
                    ) : (
                      <div className="assets-tile-loading" />
                    )}
                    {resolutionTiers[asset.path] && (
                      <span className="media-resolution-badge">{resolutionTiers[asset.path]}</span>
                    )}
                    <button
                      className="assets-tile-download"
                      onClick={() => download(asset)}
                      title={t.assets.downloadTooltip}
                      disabled={!blobUrl}
                    >
                      <IconDownload size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
