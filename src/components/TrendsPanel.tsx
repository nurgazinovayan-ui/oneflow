import { useEffect, useMemo, useRef, useState } from 'react';
import { useT, useLanguageStore } from '../i18n';
import { ADMIN_EMAIL } from '../types';
import { IconClose, IconCalendar, IconRepost, IconHeart, IconRefresh, IconTikTok, IconInstagram, IconThreads } from './Icons';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

type Platform = 'tiktok' | 'instagram' | 'threads';
type RangeKey = 'today' | '3d' | '10d';

const RANGE_DAYS: Record<RangeKey, number> = { today: 0, '3d': 3, '10d': 10 };
const PLATFORM_LABELS: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram', threads: 'Threads' };

interface TrendWatchItem {
  id: string;
  platform: Platform;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  author: string | null;
  stats: { views?: number; likes?: number; shares?: number; comments?: number } | null;
  ai_advice: string | null;
  popularity_score: number;
  region_rank: number;
  fetch_date: string;
  fetched_at: string;
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function relativeTime(iso: string, locale: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffHours = Math.round(diffMs / 3_600_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diffHours < 1) return rtf.format(0, 'hour');
  if (diffHours < 24) return rtf.format(-diffHours, 'hour');
  return rtf.format(-Math.round(diffHours / 24), 'day');
}

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function PlatformIcon({ platform, size }: { platform: Platform; size: number }) {
  if (platform === 'tiktok') return <IconTikTok size={size} />;
  if (platform === 'instagram') return <IconInstagram size={size} />;
  return <IconThreads size={size} />;
}

function Preview({ item }: { item: TrendWatchItem }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const showVideo = Boolean(item.video_url) && !videoFailed;
  const showImg = !showVideo && Boolean(item.thumbnail_url) && !imgFailed;
  return (
    <figure>
      {showVideo ? (
        <video controls preload="metadata" poster={item.thumbnail_url ?? undefined} src={item.video_url!} onError={() => setVideoFailed(true)} />
      ) : showImg ? (
        <img src={item.thumbnail_url!} alt={item.title} loading="lazy" onError={() => setImgFailed(true)} />
      ) : (
        // No usable video/image (always the case for Threads, occasionally for a TikTok/Instagram
        // item whose media link didn't resolve) — show the post's own text instead of a blank tile.
        <div className="trends-preview-text"><p>{item.description || item.title}</p></div>
      )}
      <span className="trends-card-badge" aria-hidden="true">
        <PlatformIcon platform={item.platform} size={17} />
      </span>
    </figure>
  );
}

function TrendCard({ item, locale, onOpen }: { item: TrendWatchItem; locale: string; onOpen: () => void }) {
  const t = useT().trends;
  const stats = item.stats ?? {};
  return (
    <article className="trends-card">
      <button className="trends-card-open" onClick={onOpen} aria-label={item.title}>
        <Preview item={item} />
        <h2>{item.title}</h2>
        <div className="trends-card-stats">
          <span className="trends-card-stat"><IconCalendar size={12} />{relativeTime(item.fetched_at, locale)}</span>
          {stats.shares !== undefined && <span className="trends-card-stat"><IconRepost size={12} />{formatStat(stats.shares)}</span>}
          {stats.likes !== undefined && <span className="trends-card-stat"><IconHeart size={12} />{formatStat(stats.likes)}</span>}
        </div>
      </button>
    </article>
  );
}

function TrendDetail({ item, locale, onClose }: { item: TrendWatchItem; locale: string; onClose: () => void }) {
  const t = useT().trends;
  const dialog = useRef<HTMLDialogElement>(null);
  const stats = item.stats ?? {};
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="trends-dialog"
      aria-labelledby="trend-detail-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
        }
      }}
    >
      <header className="trends-detail-header">
        <h2 id="trend-detail-title">{item.title}</h2>
        <button autoFocus onClick={onClose} aria-label={t.close}><IconClose /></button>
      </header>
      <section className="trends-detail-layout">
        <Preview item={item} />
        <section className="trends-detail-copy">
          {item.description && <p>{item.description}</p>}
          <div className="trends-detail-stats">
            <div className="trends-detail-stat"><span>{t.appearedLabel}</span><span>{relativeTime(item.fetched_at, locale)}</span></div>
            <div className="trends-detail-stat"><span>{t.repostsLabel}</span><span>{stats.shares !== undefined ? formatStat(stats.shares) : '—'}</span></div>
            <div className="trends-detail-stat"><span>{t.likesLabel}</span><span>{stats.likes !== undefined ? formatStat(stats.likes) : '—'}</span></div>
          </div>
          {item.ai_advice && (
            <div className="trends-detail-advice">
              <p className="trends-detail-advice-label">{t.adviceLabel}</p>
              <p>{item.ai_advice}</p>
            </div>
          )}
          <div className="trends-detail-footer">
            {item.author && <span>{t.author}: {item.author}</span>}
            {item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer">{t.openSource} ↗</a>}
          </div>
        </section>
      </section>
    </dialog>
  );
}

export default function TrendsPanel({ active, authEmail }: { active: boolean; authEmail: string | null }) {
  const t = useT().trends;
  const language = useLanguageStore((s) => s.language);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const isAdmin = authEmail?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const [items, setItems] = useState<TrendWatchItem[]>([]);
  const [platform, setPlatform] = useState<'' | Platform>('');
  const [range, setRange] = useState<RangeKey>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<TrendWatchItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({
      select: '*',
      // CIS first, then Europe, then America (region_rank), most popular first inside each.
      order: 'region_rank.asc,popularity_score.desc',
      limit: '500',
      fetch_date: `gte.${cutoffDate(RANGE_DAYS[range])}`,
    });
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
  }, [active, platform, range, reloadKey]);

  // Admin-only manual trigger — trendswatch-refresh itself has a cooldown (see its own code)
  // so this can't be spammed into racking up Apify/OpenRouter cost, even by someone who reads
  // the anon key out of the bundle and calls the function URL directly.
  const triggerRefresh = () => {
    setRefreshing(true);
    setRefreshError(false);
    fetch(`${SUPABASE_URL}/functions/v1/trendswatch-refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        setReloadKey((v) => v + 1);
      })
      .catch(() => setRefreshError(true))
      .finally(() => setRefreshing(false));
  };

  const latestDate = useMemo(() => items[0]?.fetch_date, [items]);

  return (
    <section className="trends-panel" hidden={!active} aria-label={t.heading}>
      <header className="trends-toolbar">
        <div>
          <h1>{t.heading}</h1>
          {latestDate && <p className="trends-updated">{t.updated(latestDate)}</p>}
          {refreshError && <p className="trends-updated" role="alert">{t.refreshError}</p>}
        </div>
        <div className="trends-toolbar-controls">
          {isAdmin && (
            <button type="button" onClick={triggerRefresh} disabled={refreshing} aria-busy={refreshing}>
              <IconRefresh size={14} /> {refreshing ? t.refreshingBtn : t.refreshBtn}
            </button>
          )}
          <nav className="trends-platform-filters" aria-label={t.allPlatforms}>
            {(['', 'tiktok', 'instagram', 'threads'] as const).map((value) => (
              <button key={value || 'all'} aria-pressed={platform === value} onClick={() => setPlatform(value)}>
                {value ? PLATFORM_LABELS[value] : t.allPlatforms}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <nav className="trends-range-filters" aria-label={t.heading}>
        {(['today', '3d', '10d'] as const).map((key) => (
          <button key={key} aria-pressed={range === key} onClick={() => setRange(key)}>
            {key === 'today' ? t.rangeToday : key === '3d' ? t.range3d : t.range10d}
          </button>
        ))}
      </nav>
      <section className="trends-scroll" aria-busy={loading}>
        {loading ? (
          <p role="status" className="trends-state">{t.loading}</p>
        ) : error ? (
          <section className="trends-state" role="alert"><p>{t.error}</p></section>
        ) : items.length === 0 ? (
          <section className="trends-state"><p>{t.empty}</p></section>
        ) : (
          <div className="trends-grid">
            {items.map((item) => (
              <TrendCard key={item.id} item={item} locale={locale} onOpen={() => setSelected(item)} />
            ))}
          </div>
        )}
      </section>
      {active && selected && <TrendDetail key={selected.id} item={selected} locale={locale} onClose={() => setSelected(null)} />}
    </section>
  );
}
