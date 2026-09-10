import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { IconVideo } from './Icons';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

type Platform = 'tiktok' | 'instagram' | 'threads';

interface TrendWatchItem {
  id: string;
  platform: Platform;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  author: string | null;
  stats: Record<string, number> | null;
  ai_advice: string | null;
  fetch_date: string;
  fetched_at: string;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  threads: 'Threads',
};

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function TrendWatchCard({ item }: { item: TrendWatchItem }) {
  const t = useT().trends;
  const [videoFailed, setVideoFailed] = useState(false);
  const hasVideo = Boolean(item.video_url) && !videoFailed;
  const stats = item.stats ?? {};

  return (
    <article className="trends-watch-card">
      <div className="trends-watch-preview">
        {hasVideo ? (
          <video
            controls
            preload="metadata"
            poster={item.thumbnail_url ?? undefined}
            src={item.video_url!}
            onError={() => setVideoFailed(true)}
          />
        ) : item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.title} loading="lazy" />
        ) : (
          <div className="trends-watch-placeholder">
            <IconVideo size={28} />
            <span>{t.watchNoVideoBadge}</span>
          </div>
        )}
        <span className={`trends-watch-badge trends-watch-badge-${item.platform}`}>
          {PLATFORM_LABELS[item.platform]}
        </span>
      </div>
      <div className="trends-watch-body">
        <h3>{item.title}</h3>
        {item.description && <p className="trends-watch-desc">{item.description}</p>}
        {(stats.views !== undefined || stats.likes !== undefined || stats.comments !== undefined) && (
          <div className="trends-watch-stats">
            {stats.views !== undefined && <span>👁 {formatStat(stats.views)}</span>}
            {stats.likes !== undefined && <span>❤ {formatStat(stats.likes)}</span>}
            {stats.comments !== undefined && <span>💬 {formatStat(stats.comments)}</span>}
          </div>
        )}
        {item.ai_advice && (
          <p className="trends-watch-advice">
            <strong>{t.watchAdviceLabel}</strong> {item.ai_advice}
          </p>
        )}
        <div className="trends-watch-footer">
          {item.author && <span className="trends-meta">{item.author}</span>}
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer">
              {t.watchOpenSource} ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function TrendsWatchPanel({ active }: { active: boolean }) {
  const t = useT().trends;
  const [items, setItems] = useState<TrendWatchItem[]>([]);
  const [platform, setPlatform] = useState<'' | Platform>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ select: '*', order: 'fetched_at.desc', limit: '90' });
    if (platform) params.set('platform', `eq.${platform}`);
    // trend_watch_items has an open "select" RLS policy (see trendswatch-refresh's SQL
    // comment) — this is shared, non-sensitive content, same for every signed-in user, so
    // the anon key alone is enough here without a per-user Authorization header.
    fetch(`${SUPABASE_URL}/rest/v1/trend_watch_items?${params.toString()}`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<TrendWatchItem[]>;
      })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, platform]);

  const latestDate = useMemo(() => items[0]?.fetch_date, [items]);

  return (
    <section className="trends-watch-panel" hidden={!active} aria-label={t.heading}>
      <header className="trends-watch-toolbar">
        {latestDate && <p className="trends-meta">{t.watchUpdated(latestDate)}</p>}
        <nav className="trends-kind" aria-label={t.watchAllPlatforms}>
          {(['', 'tiktok', 'instagram', 'threads'] as const).map((value) => (
            <button key={value || 'all'} aria-pressed={platform === value} onClick={() => setPlatform(value)}>
              {value ? PLATFORM_LABELS[value] : t.watchAllPlatforms}
            </button>
          ))}
        </nav>
      </header>
      <section className="trends-watch-scroll" aria-busy={loading}>
        {loading ? (
          <p role="status" className="trends-state">
            {t.watchLoading}
          </p>
        ) : error ? (
          <section className="trends-state" role="alert">
            <p>{t.watchError}</p>
          </section>
        ) : items.length === 0 ? (
          <section className="trends-state">
            <p>{t.watchEmpty}</p>
          </section>
        ) : (
          <div className="trends-watch-grid">
            {items.map((item) => (
              <TrendWatchCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
