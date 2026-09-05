import { useEffect, useState } from 'react';
import type { BudgetUsage } from '../types';
import { useT } from '../i18n';

const POLL_INTERVAL_MS = 8000;

// Soft green (fresh budget) fading to a raspberry/magenta (near the limit) — same tone as the
// avatar's "no subscription" glow, so the app uses one consistent color for "getting close to a
// limit" everywhere.
const SAFE_COLOR = { r: 0x34, g: 0xd3, b: 0x99 }; // #34d399
const DANGER_COLOR = { r: 0xe0, g: 0x24, b: 0x6b }; // #e0246b

function budgetBarColor(spentPercent: number): string {
  const t = Math.min(100, Math.max(0, spentPercent)) / 100;
  const r = Math.round(SAFE_COLOR.r + (DANGER_COLOR.r - SAFE_COLOR.r) * t);
  const g = Math.round(SAFE_COLOR.g + (DANGER_COLOR.g - SAFE_COLOR.g) * t);
  const b = Math.round(SAFE_COLOR.b + (DANGER_COLOR.b - SAFE_COLOR.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function BudgetBar() {
  const t = useT();
  const [usage, setUsage] = useState<BudgetUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.api.getUsage().then((u) => {
        if (!cancelled) setUsage(u);
      });
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!usage) return null;

  // Defensive: guards against stale/malformed persisted usage data (e.g. from an older
  // count-based build) so a bad shape can't crash the whole app on startup.
  const costUsd = Number.isFinite(usage.costUsd) ? usage.costUsd : 0;
  const limit = Number.isFinite(usage.limit) && usage.limit > 0 ? usage.limit : 50;
  const percent = Math.min(100, Math.round((costUsd / Math.max(0.01, limit)) * 100));
  // Remaining-budget bar, not a spent-budget one: full-width and green when fresh, shrinking and
  // sliding toward raspberry as the limit approaches, rather than filling up.
  const remainingPercent = 100 - percent;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="budget-bar" title={t.budget.tooltip(fmt(costUsd), fmt(limit))}>
      <span className="budget-bar-label">
        {fmt(costUsd)}/{fmt(limit)}
      </span>
      <div className="budget-bar-track">
        <div
          className="budget-bar-fill"
          style={{ width: `${remainingPercent}%`, background: budgetBarColor(percent) }}
        />
      </div>
    </div>
  );
}
