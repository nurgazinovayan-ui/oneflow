import { useEffect, useRef, useState } from 'react';
import { IconAssetsFolder, IconDownload, IconImage, IconPlay, IconTrash, IconVideo } from './Icons';
import type { UserAsset } from '../types';
import { resolutionTierFromPixels, type ResolutionTier } from '../resolutionBadge';
import { useT } from '../i18n';

interface AssetsPanelProps {
  active: boolean;
}

type Filter = 'all' | 'image' | 'video';

const PAGE = 30;

// Everything the signed-in user has generated, kept on the server (supabase/functions/user-assets),
// so it is the same on every device — reached via the "Ассеты" button next to BudgetBar.
// Toggled the same way as TextWorkPanel/EvaluationPanel/MusicAudioPanel etc. (always mounted,
// hidden via CSS while inactive) rather than as a separate overlay/modal, so switching to it and
// back behaves exactly like switching between any other mode. Reloads the first page on every
// activation, so what was just generated is there.
export default function AssetsPanel({ active }: AssetsPanelProps) {
  const t = useT();
  const [assets, setAssets] = useState<UserAsset[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  // the stored files carry no resolution metadata, so it's read off the decoded media once each
  // tile loads (see the badge below)
  const [resolutionTiers, setResolutionTiers] = useState<Record<string, ResolutionTier>>({});
  const request = useRef(0); // a newer load wins over a slower older one

  const load = async (before?: string) => {
    const mine = ++request.current;
    try {
      const page = await window.api.listAssets({ kind: filter === 'all' ? undefined : filter, before, limit: PAGE });
      if (mine !== request.current) return;
      setAssets((prev) => (before && prev ? [...prev, ...page.items] : page.items));
      setNext(page.next);
      setError('');
    } catch (err) {
      if (mine !== request.current) return;
      setError(err instanceof Error ? err.message : String(err));
      if (!before) setAssets([]);
    }
  };

  useEffect(() => {
    if (!active) return;
    setAssets(null);
    setConfirmId(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filter]);

  const loadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    await load(next);
    setLoadingMore(false);
  };

  const download = (asset: UserAsset) => {
    const ext = /\.(png|jpe?g|webp|mp4)(\?|$)/i.exec(asset.url)?.[1]?.toLowerCase() ?? (asset.kind === 'video' ? 'mp4' : 'png');
    void window.api.saveFile(asset.url, `oneflow-${asset.createdAt.slice(0, 10)}-${asset.id.slice(0, 8)}.${ext}`);
  };

  const remove = async (asset: UserAsset) => {
    setConfirmId(null);
    try {
      await window.api.deleteAsset(asset.id);
      setAssets((prev) => (prev ?? []).filter((a) => a.id !== asset.id));
    } catch {
      setError(t.assets.deleteError);
    }
  };

  const visible = assets ?? [];

  return (
    <div className={`assets-panel ${active ? '' : 'assets-panel-hidden'}`}>
      <div className="assets-panel-body">
        <div className="assets-sidebar">
          <button className={`assets-sort-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            {t.assets.filterAll}
          </button>
          <button className={`assets-sort-btn ${filter === 'image' ? 'active' : ''}`} onClick={() => setFilter('image')}>
            <IconImage size={13} /> {t.assets.filterPhoto}
          </button>
          <button className={`assets-sort-btn ${filter === 'video' ? 'active' : ''}`} onClick={() => setFilter('video')}>
            <IconVideo size={13} /> {t.assets.filterVideo}
          </button>
        </div>

        <div className="assets-grid-area">
          {assets === null && <div className="connected-hint assets-hint">{t.assets.loadingHint}</div>}

          {assets !== null && error && <div className="connected-hint assets-hint">{`${t.assets.loadError} (${error})`}</div>}

          {assets !== null && !error && visible.length === 0 && (
            <div className="v2-empty">
              <span className="v2-empty-icon">
                <IconAssetsFolder size={22} />
              </span>
              <h2>{t.home.assets}</h2>
              <p>{t.assets.emptyHint}</p>
            </div>
          )}

          {visible.length > 0 && (
            <div className="assets-grid">
              {visible.map((asset) => (
                <div key={asset.id} className="assets-tile" title={asset.prompt || undefined}>
                  {failedIds[asset.id] ? (
                    <div className="assets-tile-error">{t.assets.tileLoadError}</div>
                  ) : asset.kind === 'image' ? (
                    <img
                      src={asset.url}
                      alt={asset.prompt}
                      loading="lazy"
                      onError={() => setFailedIds((prev) => ({ ...prev, [asset.id]: true }))}
                      onLoad={(e) => {
                        const el = e.currentTarget;
                        setResolutionTiers((prev) => ({ ...prev, [asset.id]: resolutionTierFromPixels(Math.max(el.naturalWidth, el.naturalHeight)) }));
                      }}
                    />
                  ) : (
                    <video
                      src={`${asset.url}#t=0.5`} // the first frame is often black or white
                      muted
                      playsInline
                      loop
                      preload="metadata"
                      onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())}
                      onError={() => setFailedIds((prev) => ({ ...prev, [asset.id]: true }))}
                      onLoadedMetadata={(e) => {
                        const el = e.currentTarget;
                        setResolutionTiers((prev) => ({ ...prev, [asset.id]: resolutionTierFromPixels(Math.max(el.videoWidth, el.videoHeight)) }));
                      }}
                    />
                  )}
                  {resolutionTiers[asset.id] && <span className="media-resolution-badge">{resolutionTiers[asset.id]}</span>}
                  {asset.kind === 'video' && (
                    <span className="assets-tile-play" aria-hidden>
                      <IconPlay size={12} />
                    </span>
                  )}
                  <button className="assets-tile-download" onClick={() => download(asset)} title={t.assets.downloadTooltip}>
                    <IconDownload size={13} />
                  </button>
                  <button className="assets-tile-download assets-tile-delete" onClick={() => setConfirmId(asset.id)} title={t.assets.deleteTooltip}>
                    <IconTrash size={13} />
                  </button>
                  {confirmId === asset.id && (
                    <div className="assets-tile-confirm">
                      <span>{t.assets.deleteConfirm}</span>
                      <div>
                        <button className="assets-confirm-yes" onClick={() => void remove(asset)}>
                          {t.assets.deleteYes}
                        </button>
                        <button className="assets-confirm-no" onClick={() => setConfirmId(null)}>
                          {t.assets.deleteNo}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {next && visible.length > 0 && (
            <div className="assets-more">
              <button className="v2-btn2" onClick={() => void loadMore()} disabled={loadingMore}>
                {t.assets.loadMore}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
