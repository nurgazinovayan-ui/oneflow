import { useEffect, useMemo, useState } from 'react';
import { useT, useLanguageStore } from '../i18n';
import { ADMIN_EMAIL } from '../types';
import {
  IconBookmark,
  IconChevronDown,
  IconExternal,
  IconFlow,
  IconInstagram,
  IconRefresh,
  IconSearch,
  IconSliders,
  IconThreads,
  IconTikTok,
} from './Icons';
import { DEMO_TRENDS } from '../trends/demoData';
import { REGION_RANKS, type TrendPlatform, type TrendRegion, type TrendWatchItem } from '../trends/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

type RangeKey = 'today' | '7d' | '30d';
type SortKey = 'popular' | 'newest' | 'likes';

const RANGE_DAYS: Record<RangeKey, number> = { today: 0, '7d': 7, '30d': 30 };
const PLATFORM_LABELS: Record<TrendPlatform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  threads: 'Threads',
};
const SAVED_STORAGE_KEY = 'oneflow-trends-saved';

function cutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}K`;
  return String(Math.round(n));
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

// The row's headline number. The collector stores a snapshot, not a history, so there is no
// growth rate to report — this shows whichever real figure the source gave us, strongest first.
function itemMetric(item: TrendWatchItem, t: ReturnType<typeof useT>['trends']) {
  const s = item.stats ?? {};
  if (s.likes !== undefined) return { label: t.metricLikes, value: formatStat(s.likes) };
  if (s.views !== undefined) return { label: t.metricViews, value: formatStat(s.views) };
  if (s.shares !== undefined) return { label: t.metricReposts, value: formatStat(s.shares) };
  if (s.comments !== undefined) return { label: t.metricComments, value: formatStat(s.comments) };
  return { label: t.metricNone, value: '—' };
}

function PlatformIcon({ platform, size }: { platform: TrendPlatform; size: number }) {
  if (platform === 'tiktok') return <IconTikTok size={size} />;
  if (platform === 'instagram') return <IconInstagram size={size} />;
  return <IconThreads size={size} />;
}

// Threads posts carry no media at all, and the occasional TikTok/Instagram thumbnail fails to
// resolve — so every image slot needs a text fallback rather than a grey rectangle.
function Thumb({ item, className }: { item: TrendWatchItem; className: string }) {
  const [failed, setFailed] = useState(false);
  const src = item.thumbnail_url;
  if (!src || failed) {
    return (
      <div className={`${className} tw-thumb-text`}>
        <span>{item.description || item.title}</span>
      </div>
    );
  }
  return <img className={className} src={src} alt={item.title} loading="lazy" onError={() => setFailed(true)} />;
}

function Avatar({ author }: { author: string | null }) {
  const letter = (author ?? '?').replace(/^@/, '').charAt(0).toUpperCase();
  return (
    <span className="tw-avatar" aria-hidden="true">
      {letter}
    </span>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="tw-select">
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevronDown size={14} />
    </div>
  );
}

interface TrendsPanelProps {
  active: boolean;
  authEmail: string | null;
  onCreateScenario: (item: TrendWatchItem) => void;
  onSendToNodes: (item: TrendWatchItem) => void;
}

export default function TrendsPanel({ active, authEmail, onCreateScenario, onSendToNodes }: TrendsPanelProps) {
  const t = useT().trends;
  const language = useLanguageStore((s) => s.language);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const isAdmin = authEmail?.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const [fetched, setFetched] = useState<TrendWatchItem[]>([]);
  const [platform, setPlatform] = useState<'' | TrendPlatform>('');
  const [range, setRange] = useState<RangeKey>('7d');
  const [sort, setSort] = useState<SortKey>('popular');
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<'' | TrendRegion>('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

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
        if (!cancelled) setFetched(data);
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
  }, [active, range, reloadKey]);

  // Nothing in the table yet (or it couldn't be read) — show the labelled example set rather
  // than an empty screen. isDemo drives the badge, and that badge is what keeps invented
  // numbers from being mistaken for real reach figures.
  const isDemo = !loading && fetched.length === 0;
  const source = isDemo ? DEMO_TRENDS : fetched;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = source.filter((item) => {
      if (platform && item.platform !== platform) return false;
      if (region && item.region_rank !== REGION_RANKS[region]) return false;
      if (savedOnly && !saved.includes(item.id)) return false;
      if (!q) return true;
      return [item.title, item.description, item.author, item.ai_advice]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q));
    });
    const sorted = [...filtered];
    if (sort === 'newest') sorted.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
    else if (sort === 'likes') sorted.sort((a, b) => (b.stats?.likes ?? 0) - (a.stats?.likes ?? 0));
    else sorted.sort((a, b) => a.region_rank - b.region_rank || b.popularity_score - a.popularity_score);
    return sorted;
  }, [source, platform, region, savedOnly, saved, query, sort]);

  // Keep a selection alive across filtering: fall back to the first row whenever the selected
  // one is filtered away, so the detail pane is never blank while the list has content.
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  const toggleSaved = (id: string) => {
    setSaved((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode or blocked storage: the toggle still works for this session.
      }
      return next;
    });
  };

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

  const settingsActive = region !== '' || savedOnly;
  const today = formatDate(new Date().toISOString(), locale);

  return (
    <section className="tw-panel" hidden={!active} aria-label={t.heading}>
      <header className="tw-head">
        <div className="tw-head-main">
          <div className="tw-head-title">
            <h1>{t.pageTitle}</h1>
            {isDemo && (
              <span className="tw-demo-badge" title={t.demoHint}>
                <span className="tw-demo-dot" aria-hidden="true" />
                {t.demoBadge}
              </span>
            )}
          </div>
          <p className="tw-subtitle">{t.subtitle}</p>
        </div>
        <div className="tw-head-side">
          {isAdmin && (
            <button
              className="tw-refresh"
              type="button"
              onClick={triggerRefresh}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <IconRefresh size={14} /> {refreshing ? t.refreshingBtn : t.refreshBtn}
            </button>
          )}
          <span className="tw-date">{today}</span>
        </div>
      </header>

      {refreshError && (
        <p className="tw-alert" role="alert">
          {t.refreshError}
        </p>
      )}

      <div className="tw-filters">
        <div className="tw-search">
          <IconSearch size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
          />
        </div>
        <Select
          ariaLabel={t.allPlatforms}
          value={platform}
          onChange={setPlatform}
          options={[
            { value: '' as const, label: t.allPlatforms },
            ...(Object.keys(PLATFORM_LABELS) as TrendPlatform[]).map((p) => ({
              value: p,
              label: PLATFORM_LABELS[p],
            })),
          ]}
        />
        <Select
          ariaLabel={t.range7d}
          value={range}
          onChange={setRange}
          options={[
            { value: 'today', label: t.rangeToday },
            { value: '7d', label: t.range7d },
            { value: '30d', label: t.range30d },
          ]}
        />
        <Select
          ariaLabel={t.sortPopular}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'popular', label: t.sortPopular },
            { value: 'newest', label: t.sortNewest },
            { value: 'likes', label: t.sortLikes },
          ]}
        />
        <div className="tw-settings-wrap">
          <button
            className={`tw-settings-btn ${settingsActive ? 'active' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
          >
            <IconSliders size={15} />
            {t.searchSettings}
            {settingsActive && <span className="tw-settings-dot" aria-hidden="true" />}
          </button>
          {settingsOpen && (
            <>
              <div className="tw-settings-scrim" onClick={() => setSettingsOpen(false)} />
              <div className="tw-settings-pop" role="dialog" aria-label={t.searchSettings}>
                <div className="tw-settings-group">
                  <span className="tw-settings-label">{t.settingsRegion}</span>
                  <div className="tw-chips">
                    {([
                      ['', t.regionAll],
                      ['cis', t.regionCis],
                      ['europe', t.regionEurope],
                      ['america', t.regionAmerica],
                      ['unknown', t.regionUnknown],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value || 'all'}
                        className={`tw-chip ${region === value ? 'active' : ''}`}
                        onClick={() => setRegion(value as '' | TrendRegion)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="tw-settings-note">{t.regionNote}</p>
                </div>
                <div className="tw-settings-group">
                  <span className="tw-settings-label">{t.settingsShow}</span>
                  <div className="tw-chips">
                    <button className={`tw-chip ${!savedOnly ? 'active' : ''}`} onClick={() => setSavedOnly(false)}>
                      {t.showAll}
                    </button>
                    <button className={`tw-chip ${savedOnly ? 'active' : ''}`} onClick={() => setSavedOnly(true)}>
                      {t.showSaved}
                    </button>
                  </div>
                </div>
                <button
                  className="tw-settings-reset"
                  disabled={!settingsActive}
                  onClick={() => {
                    setRegion('');
                    setSavedOnly(false);
                  }}
                >
                  {t.settingsReset}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="tw-body">
        <div className="tw-list" aria-busy={loading}>
          {loading ? (
            <p className="tw-state" role="status">
              {t.loading}
            </p>
          ) : error && !isDemo ? (
            <p className="tw-state" role="alert">
              {t.error}
            </p>
          ) : items.length === 0 ? (
            <p className="tw-state">{query.trim() || platform || settingsActive ? t.noMatches : t.empty}</p>
          ) : (
            items.map((item) => {
              const metric = itemMetric(item, t);
              const isSelected = selected?.id === item.id;
              return (
                <div key={item.id} className={`tw-row ${isSelected ? 'selected' : ''}`}>
                  <button className="tw-row-main" onClick={() => setSelectedId(item.id)} aria-current={isSelected}>
                    <Thumb item={item} className="tw-row-thumb" />
                    <span className="tw-row-body">
                      <span className="tw-row-platform">
                        <PlatformIcon platform={item.platform} size={14} />
                        {PLATFORM_LABELS[item.platform]}
                      </span>
                      <span className="tw-row-title">{item.title}</span>
                      <span className="tw-row-author">
                        <Avatar author={item.author} />@{(item.author ?? '').replace(/^@/, '')}
                      </span>
                    </span>
                    <span className="tw-row-metric">
                      <span className="tw-metric-label">{metric.label}</span>
                      <span className="tw-metric-value">{metric.value}</span>
                      <span className="tw-metric-sub">{formatDate(item.fetched_at, locale)}</span>
                    </span>
                  </button>
                  <button
                    className={`tw-bookmark ${saved.includes(item.id) ? 'active' : ''}`}
                    onClick={() => toggleSaved(item.id)}
                    title={saved.includes(item.id) ? t.saved : t.save}
                    aria-pressed={saved.includes(item.id)}
                  >
                    <IconBookmark size={16} filled={saved.includes(item.id)} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="tw-detail">
          {!selected ? (
            <p className="tw-state">{t.selectHint}</p>
          ) : (
            <>
              <div className="tw-detail-media">
                <Thumb item={selected} className="tw-detail-img" />
                <div className="tw-detail-media-actions">
                  {selected.source_url && (
                    <a
                      className="tw-detail-open"
                      href={selected.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconExternal size={13} /> {t.openOriginal}
                    </a>
                  )}
                  <button
                    className={`tw-detail-bookmark ${saved.includes(selected.id) ? 'active' : ''}`}
                    onClick={() => toggleSaved(selected.id)}
                    title={saved.includes(selected.id) ? t.saved : t.save}
                    aria-pressed={saved.includes(selected.id)}
                  >
                    <IconBookmark size={16} filled={saved.includes(selected.id)} />
                  </button>
                </div>
              </div>

              <h2 className="tw-detail-title">{selected.title}</h2>
              <div className="tw-detail-byline">
                <Avatar author={selected.author} />
                <span>@{(selected.author ?? '').replace(/^@/, '')}</span>
                <span className="tw-dot">•</span>
                <PlatformIcon platform={selected.platform} size={13} />
                <span>{PLATFORM_LABELS[selected.platform]}</span>
                <span className="tw-dot">•</span>
                <span>{formatDate(selected.fetched_at, locale)}</span>
              </div>

              <div className="tw-detail-section">
                <h3>{t.whyHeading}</h3>
                <p>{selected.description || t.whyFallback}</p>
              </div>
              {selected.ai_advice && (
                <div className="tw-detail-section">
                  <h3>{t.howHeading}</h3>
                  <p>{selected.ai_advice}</p>
                </div>
              )}

              <div className="tw-detail-actions">
                <button className="tw-cta" onClick={() => onCreateScenario(selected)}>
                  {t.createScenario} <span aria-hidden="true">→</span>
                </button>
                <button className="tw-cta secondary" onClick={() => onSendToNodes(selected)}>
                  <IconFlow size={14} /> {t.toNodes}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
