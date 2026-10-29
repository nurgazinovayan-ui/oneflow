import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowUp, IconExternal, IconPlay } from './Icons';
import type { AppView, ModeDef } from '../modes';
import { subscribeCredits, useCredits } from '../credits';
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
const SIDE_SLIDE_MS = 9000; // the square banner turns on its own beat, not in step with the big one

// Built-in banner (one slide, by request), shown until the admin panel has saved its own (see homeBanners.ts). Text
// comes from i18n (t.home.slides) in the same order.
const DEFAULT_MEDIA: { view: AppView; video?: boolean; src: string; poster?: string }[] = [
  { view: 'motion', video: true, src: '/oneflow-hero.mp4', poster: '/home-banner-poster.webp' },
];

// Built-in square banner next to it, shown until the admin panel has saved its own square ones. Text
// comes from t.home.sideSlides in the same order.
const DEFAULT_SIDE: { view: AppView; src: string }[] = [{ view: 'generate', src: '/auth-gallery/make-a-scene.webp' }];

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
  const credits = useCredits((s) => s.balance);
  const openTopUp = useCredits((s) => s.openTopUp);
  const language = useLanguageStore((s) => s.language);
  const views = useMemo(() => modes.map((m) => m.value), [modes]);
  const [stored, setStored] = useState<string | null>(() => readCachedBanners());

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
    const custom = stored ? parseBanners(stored, language === 'en' ? 'en' : 'ru', views, 'slides') : [];
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

  const side: BannerSlide[] = useMemo(() => {
    const custom = stored ? parseBanners(stored, language === 'en' ? 'en' : 'ru', views, 'side') : [];
    if (custom.length) return custom;
    return DEFAULT_SIDE.map((m, i) => ({
      id: `default-side-${i}`,
      mediaType: 'image',
      media: m.src,
      tag: t.home.sideSlides[i]?.tag ?? '',
      title: t.home.sideSlides[i]?.title ?? '',
      text: t.home.sideSlides[i]?.text ?? '',
      button: t.home.more,
      link: { kind: 'mode', view: m.view },
    }));
  }, [stored, language, views, t]);

  // Credit balance (shared store; polled while the home screen is open).
  useEffect(() => {
    if (!active) return;
    return subscribeCredits();
  }, [active]);

  const g = greetingKey(new Date().getHours());
  const left = credits ? Math.max(0, credits.available - credits.reserved) : null;
  const pct = credits ? (credits.unlimited ? 1 : credits.activeTotal > 0 ? Math.min(1, left! / credits.activeTotal) : 0) : 0;
  const R = 11;
  const C = 2 * Math.PI * R;

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
            {left !== null && credits && (
              <div className="home-kpi home-kpi-credits">
                <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="14" cy="14" r={R} fill="none" stroke="var(--home-track)" strokeWidth="4" />
                  {pct > 0 && (
                    <circle cx="14" cy="14" r={R} fill="none" stroke="var(--home-accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} />
                  )}
                </svg>
                <div>
                  <b>{credits.unlimited ? t.credits.unlimited : t.credits.count(left)}</b>
                  {t.credits.onBalance}
                </div>
                <button className="home-topup-btn" onClick={openTopUp}>
                  {t.credits.topUp}
                </button>
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

        {/* the 16:9 banner and the square one beside it, the same height */}
        <div className="home-banners">
          <BannerCarousel slides={slides} active={active} interval={SLIDE_MS} onOpen={onOpen} />
          {side.length > 0 && <BannerCarousel slides={side} active={active} interval={SIDE_SLIDE_MS} onOpen={onOpen} square />}
        </div>

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

interface BannerCarouselProps {
  slides: BannerSlide[];
  active: boolean;
  interval: number;
  onOpen: (view: AppView) => void;
  /** the square banner next to the 16:9 one: text along the bottom instead of on the left */
  square?: boolean;
}

// One banner with its slides: picture or video, optional text and button, arrows and dots when
// there is more than one slide. The 16:9 banner and the square one are two of these, each turning
// on its own.
function BannerCarousel({ slides, active, interval, onOpen, square = false }: BannerCarouselProps) {
  const t = useT();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const count = slides.length;
  const current = Math.min(slide, Math.max(0, count - 1));

  useEffect(() => {
    if (slide >= count) setSlide(0);
  }, [slide, count]);

  // Autoplay: the timer restarts on every slide change, so a manual switch (arrows/dots) always
  // gets the full interval before the next automatic one.
  useEffect(() => {
    if (!active || paused || reduceMotion || count < 2) return;
    const id = setTimeout(() => setSlide((s) => (s + 1) % count), interval);
    return () => clearTimeout(id);
  }, [active, paused, reduceMotion, count, current, interval]);

  // Only the visible slide's video plays, and only while the home screen is shown.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (active && i === current && !reduceMotion) void v.play().catch(() => undefined);
      else v.pause();
    });
  }, [active, current, reduceMotion, slides]);

  const cur = slides[current];
  if (!cur) return null;
  // texts are optional: the dark shade is there only for them, so without any the picture or video
  // stays clean and a button (if set) sits in its corner
  const hasText = Boolean(cur.tag || cur.title || cur.text);
  const hasButton = Boolean(cur.link && (cur.button || cur.link.kind === 'mode'));

  return (
    <div
      className={`home-banner${square ? ' home-banner-side' : ''}${hasText ? ' has-text' : ''}`}
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
      {(hasText || hasButton) && (
        <div className={`home-banner-text${hasText ? '' : ' bare'}`}>
          {cur.tag && <span className="home-tag">{cur.tag}</span>}
          {cur.title && <h2>{cur.title}</h2>}
          {cur.text && <p>{cur.text}</p>}
          {hasButton && cur.link && (
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
  );
}
