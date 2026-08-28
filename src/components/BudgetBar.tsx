import { useEffect, useState } from 'react';
import type { BudgetUsage } from '../types';
import { useT } from '../i18n';

const POLL_INTERVAL_MS = 8000;

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
  const overLimit = costUsd >= limit;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="budget-bar" title={t.budget.tooltip(fmt(costUsd), fmt(limit))}>
      <span className="budget-bar-label">
        {fmt(costUsd)}/{fmt(limit)}
      </span>
      <div className="budget-bar-track">
        <div
          className={`budget-bar-fill ${overLimit ? 'over' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
