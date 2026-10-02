import { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconPlay } from './Icons';
import type { AppView, ModeDef } from '../modes';
import type { BudgetUsage } from '../types';
import { useT } from '../i18n';

interface HomePanelProps {
  active: boolean;
  modes: ModeDef[];
  lastView: AppView | null;
  planLabel: string;
  onOpen: (view: AppView) => void;
}

const SLIDE_MS = 7000;

// Banner slides: one media + the mode «Подробнее» opens. Text comes from i18n (t.home.slides) in
// the same order.
const SLIDE_MEDIA: { view: AppView; video?: boolean; src: string }[] = [
  { view: 'motion', video: true, src: '/oneflow-hero' },
  { view: 'onelaunch', src: '/onelaunch-templates/electronics/02.jpg' },
  { view: 'evaluate', src: '/onelaunch-templates/premium/04-pyramid.jpg' },
];

function greetingKey(h: number): 'Morning' | 'Day' | 'Evening' | 'Night' {
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 18) return 'Day';
  if (h >= 18 && h < 23) return 'Evening';
  return 'Night';
}

// Web home screen after sign-in: greeting, resume-last-mode line, budget, a banner carousel and
// every mode as a tile with a one-line explanation.
export default function HomePanel({ active, modes, lastView, planLabel, onOpen }: HomePanelProps) {
  const t = useT();
  const [usage, setUsage] = useState<BudgetUsage | null>(null);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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

  useEffect(() => {
    if (!active || paused || reduceMotion) return;
    const id = setInterval(() => setSlide((s) => (s + 1) % SLIDE_MEDIA.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [active, paused, reduceMotion]);

  // The banner video only plays while the home screen is visible and its slide is shown.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active && slide === 0 && !reduceMotion) void v.play().catch(() => undefined);
    else v.pause();
  }, [active, slide, reduceMotion]);

  const g = greetingKey(new Date().getHours());
  const last = lastView ? modes.find((m) => m.value === lastView) : undefined;
  const left = usage ? Math.max(0, usage.limit - usage.costUsd) : null;
  const pct = usage && usage.limit > 0 ? Math.min(1, left! / usage.limit) : 0;
  const R = 11;
  const C = 2 * Math.PI * R;
  const media = SLIDE_MEDIA[slide];
  const text = t.home.slides[slide];

  return (
    <section className="home-panel" hidden={!active} aria-label={t.home.navLabel}>
      <div className="home-inner">
        <div className="home-hello">
          <div>
            <h1>
              {t.home[`greeting${g}`]} <em>{t.home[`greetingAccent${g}`]}</em>
            </h1>
            <p>
              {last ? t.home.resume(last.label) : t.home.welcomeNew}
              {last && (
                <button type="button" className="home-resume" onClick={() => onOpen(last.value)}>
                  {t.home.resumeBtn} →
                </button>
              )}
            </p>
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

        <div
          className="home-banner"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="home-banner-text">
            <span className="home-tag">{text.tag}</span>
            <h2>{text.title}</h2>
            <p>{text.text}</p>
            <button type="button" className="home-more" onClick={() => onOpen(media.view)}>
              <span className="home-more-icon">
                <IconPlay size={13} />
              </span>
              {t.home.more}
            </button>
          </div>
          <div className="home-banner-media">
            {SLIDE_MEDIA.map((m, i) =>
              m.video ? (
                <video
                  key={m.src}
                  ref={videoRef}
                  className={i === slide ? 'on' : ''}
                  poster="/home-banner-poster.webp"
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  <source src={`${m.src}.webm`} type="video/webm" />
                  <source src={`${m.src}.mp4`} type="video/mp4" />
                </video>
              ) : (
                <img key={m.src} src={m.src} alt="" className={i === slide ? 'on' : ''} loading="lazy" />
              ),
            )}
            {media.video && (
              <span className="home-video-badge">
                <i />
                {t.home.video}
              </span>
            )}
            <span className="home-arrows">
              <button type="button" aria-label={t.home.prevSlide} onClick={() => setSlide((s) => (s + SLIDE_MEDIA.length - 1) % SLIDE_MEDIA.length)}>
                ‹
              </button>
              <button type="button" aria-label={t.home.nextSlide} onClick={() => setSlide((s) => (s + 1) % SLIDE_MEDIA.length)}>
                ›
              </button>
            </span>
            <span className="home-dots">
              {SLIDE_MEDIA.map((_, i) => (
                <button key={i} type="button" className={i === slide ? 'on' : ''} aria-label={t.home.slideN(i + 1)} aria-current={i === slide} onClick={() => setSlide(i)} />
              ))}
            </span>
          </div>
        </div>

        <div className="home-sec">
          <h3>{t.home.modesTitle}</h3>
          <span>
            {modes.length} · {t.home.modesHint}
          </span>
        </div>
        <div className="home-tiles">
          {modes.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.value} type="button" className={`home-tile${m.badge === 'new' ? ' hi' : ''}`} onClick={() => onOpen(m.value)}>
                <span className="home-tile-icon">
                  <Icon size={22} />
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
