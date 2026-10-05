import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowUp, IconExternal, IconPlay } from './Icons';
import type { AppView, ModeDef } from '../modes';
import type { BudgetUsage } from '../types';
import { useLanguageStore, useT } from '../i18n';
import { fetchBanners, parseBanners, readCachedBanners, type BannerSlide } from '../homeBanners';

interface HomePanelProps {
  active: boolean;
  modes: ModeDef[];
  /** no longer shown on the home screen (the «continue» line was removed by request) */
  lastView: AppView | null;
  planLabel: string;
  onOpen: (view: AppView) => void;
}

const SLIDE_MS = 7000;

// Built-in banner (one slide, by request), shown until the admin panel has saved its own (see homeBanners.ts). Text
// comes from i18n (t.home.slides) in the same order.
const DEFAULT_MEDIA: { view: AppView; video?: boolean; src: string; poster?: string }[] = [
  { view: 'motion', video: true, src: '/oneflow-hero.mp4', poster: '/home-banner-poster.webp' },
];

function greetingKey(h: number): 'Morning' | 'Day' | 'Evening' | 'Night' {
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 18) return 'Day';
  if (h >= 18 && h < 23) return 'Evening';
  return 'Night';
}

// Web home screen after sign-in: greeting, budget, a banner carousel and
// every mode as a tile with a one-line explanation.
export default function HomePanel({ active, modes, planLabel, onOpen }: HomePanelProps) {
  const t = useT();
  const [usage, setUsage] = useState<BudgetUsage | null>(null);
  const language = useLanguageStore((s) => s.language);
  const views = useMemo(() => modes.map((m) => m.value), [modes]);
  const [stored, setStored] = useState<string | null>(() => readCachedBanners());
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Banners saved in the admin panel; refreshed every time the home screen is opened.
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    void fetchBanners(ctrl.signal).then((raw) => {
      if (raw !== null) setStored(raw);
    });
    return () => ctrl.abort();
  }, [active]);

  const slides: BannerSlide[] = useMemo(() => {
    const custom = stored ? parseBanners(stored, language === 'en' ? 'en' : 'ru', views) : [];
    if (custom.length) return custom;
    return DEFAULT_MEDIA.map((m, i) => ({
      id: `default-${i}`,
      mediaType: m.video ? 'video' : 'image',
      media: m.src,
      poster: m.poster,
      tag: t.home.slides[i]?.tag ?? '',
      title: t.home.slides[i]?.title ?? '',
      text: t.home.slides[i]?.text ?? '',
      button: t.home.more,
      link: { kind: 'mode', view: m.view },
    }));
  }, [stored, language, views, t]);

  const count = slides.length;
  const current = Math.min(slide, Math.max(0, count - 1));

  useEffect(() => {
    if (slide >= count) setSlide(0);
  }, [slide, count]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    window.api
      .getUsage()
      .then((u) => !cancelled && setUsage(u))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Autoplay: the timer restarts on every slide change, so a manual switch (arrows/dots) always
  // gets the full SLIDE_MS before the next automatic one.
  useEffect(() => {
    if (!active || paused || reduceMotion || count < 2) return;
    const id = setTimeout(() => setSlide((s) => (s + 1) % count), SLIDE_MS);
    return () => clearTimeout(id);
  }, [active, paused, reduceMotion, count, current]);

  // Only the visible slide's video plays, and only while the home screen is shown.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (active && i === current && !reduceMotion) void v.play().catch(() => undefined);
      else v.pause();
    });
  }, [active, current, reduceMotion, slides]);

  const g = greetingKey(new Date().getHours());
  const left = usage ? Math.max(0, usage.limit - usage.costUsd) : null;
  const pct = usage && usage.limit > 0 ? Math.min(1, left! / usage.limit) : 0;
  const R = 11;
  const C = 2 * Math.PI * R;
  const cur = slides[current];

  return (
    <section className="home-panel" hidden={!active} aria-label={t.home.navLabel}>
      <div className="home-inner">
        <div className="home-hello">
          <div>
            <h1>
              {t.home[`greeting${g}`]} <em>{t.home[`greetingAccent${g}`]}</em>
            </h1>
          </div>
          <div className="home-kpis">
            {left !== null && (
              <div className="home-kpi">
                <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="14" cy="14" r={R} fill="none" stroke="var(--home-track)" strokeWidth="4" />
                  {pct > 0 && (
                    <circle cx="14" cy="14" r={R} fill="none" stroke="var(--home-accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} />
                  )}
                </svg>
                <div>
                  <b>${left.toFixed(2)}</b>
                  {t.home.budgetLeft}
                </div>
              </div>
            )}
            <div className="home-kpi">
              <div>
                <b>{planLabel}</b>
                {t.home.planLabel}
              </div>
            </div>
          </div>
        </div>

        {cur && (
          <div
            className="home-banner"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <div className="home-banner-media" aria-hidden="true">
              {slides.map((m, i) =>
                m.mediaType === 'video' ? (
                  <video
                    key={m.id}
                    ref={(el) => {
                      videoRefs.current[i] = el;
                    }}
                    className={i === current ? 'on' : ''}
                    src={m.media}
                    poster={m.poster}
                    muted
                    loop
                    playsInline
                    preload={i === current ? 'metadata' : 'none'}
                    tabIndex={-1}
                  />
                ) : (
                  <img key={m.id} src={m.media} alt="" className={i === current ? 'on' : ''} loading={i === 0 ? 'eager' : 'lazy'} />
                ),
              )}
            </div>
            <div className="home-banner-text">
              {cur.tag && <span className="home-tag">{cur.tag}</span>}
              {cur.title && <h2>{cur.title}</h2>}
              {cur.text && <p>{cur.text}</p>}
              {cur.link && (cur.button || cur.link.kind === 'mode') && (
                cur.link.kind === 'mode' ? (
                  <button type="button" className="home-more" onClick={() => cur.link?.kind === 'mode' && onOpen(cur.link.view)}>
                    <span className="home-more-icon">
                      <IconPlay size={13} />
                    </span>
                    {cur.button || t.home.more}
                  </button>
                ) : (
                  <a className="home-more" href={cur.link.href} target="_blank" rel="noopener noreferrer">
                    <span className="home-more-icon">
                      <IconExternal size={13} />
                    </span>
                    {cur.button || t.home.more}
                  </a>
                )
              )}
            </div>
            {cur.mediaType === 'video' && (
              <span className="home-video-badge">
                <i />
                {t.home.video}
              </span>
            )}
            {count > 1 && (
              <>
                <span className="home-arrows">
                  <button type="button" aria-label={t.home.prevSlide} onClick={() => setSlide((x) => (x + count - 1) % count)}>
                    ‹
                  </button>
                  <button type="button" aria-label={t.home.nextSlide} onClick={() => setSlide((x) => (x + 1) % count)}>
                    ›
                  </button>
                </span>
                <span className="home-dots">
                  {slides.map((m, i) => (
                    <button key={m.id} type="button" className={i === current ? 'on' : ''} aria-label={t.home.slideN(i + 1)} aria-current={i === current} onClick={() => setSlide(i)} />
                  ))}
                </span>
              </>
            )}
          </div>
        )}

        <div className="home-tiles">
          {modes.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.value} type="button" className="home-tile" onClick={() => onOpen(m.value)}>
                <span className="home-tile-icon">
                  <Icon size={28} />
                </span>
                <span className="home-tile-text">
                  <b>
                    {m.label}
                    {m.badge && <span className={`home-chip ${m.badge}`}>{m.badge === 'new' ? t.home.badgeNew : t.home.badgeBeta}</span>}
                  </b>
                  <span>{m.description}</span>
                </span>
                <span className="home-tile-go" aria-hidden="true">
                  <IconArrowUp size={15} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
