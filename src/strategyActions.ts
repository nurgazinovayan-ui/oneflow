// Apply a StrategyAction to StrategyData — the ONLY mutation path for AI Insights and the
// Assistant (spec §20: "Изменения никогда не применять из свободного текста без структурированного
// action payload"). validate → persist → recompute dependents → history event, all in one place
// so every entry point (Insight card, Assistant reply) goes through the same rules.

import { genId, recomputeFunnel, allocationSum } from './strategyCompute';
import type { HistoryEvent, StrategyAction, StrategyData } from './strategyTypes';

export class StrategyActionError extends Error {}

function historyEvent(action: StrategyAction, description: string, old?: string, next?: string): HistoryEvent {
  return {
    id: genId('hist'),
    timestamp: Date.now(),
    type: action.type,
    description,
    oldValue: old,
    newValue: next,
    rationale: action.rationale,
  };
}

export function applyStrategyAction(data: StrategyData, action: StrategyAction): { data: StrategyData; event: HistoryEvent } {
  switch (action.type) {
    case 'reallocate_budget': {
      if (!action.channelChanges || action.channelChanges.length === 0) {
        throw new StrategyActionError('reallocate_budget requires channelChanges');
      }
      let channels = data.channels.map((c) => {
        const change = action.channelChanges!.find((ch) => ch.channelId === c.id);
        return change ? { ...c, percent: Math.max(0, Math.min(100, change.allocation)) } : c;
      });
      // The AI/Assistant may only touch the channels it mentions — rescale everything
      // proportionally back to 100% rather than silently leaving the mix invalid. Rounding each
      // share independently can leave the total 1-2% off 100, so the last channel absorbs
      // whatever remainder rounding left behind.
      const sum = allocationSum(channels);
      if (sum !== 100 && sum > 0) {
        channels = channels.map((c) => ({ ...c, percent: Math.round((c.percent / sum) * 100) }));
        const drift = 100 - allocationSum(channels);
        if (drift !== 0) {
          const last = channels[channels.length - 1];
          channels = channels.map((c) =>
            c.id === last.id ? { ...c, percent: Math.max(0, c.percent + drift) } : c
          );
        }
      }
      const old = data.channels.map((c) => `${c.name} ${c.percent}%`).join(', ');
      const next = channels.map((c) => `${c.name} ${c.percent}%`).join(', ');
      return {
        data: { ...data, channels },
        event: historyEvent(action, 'Перераспределение бюджета по каналам', old, next),
      };
    }

    case 'set_primary_positioning': {
      const alt = data.positioning.alternatives.find((a) => a.id === action.positioningAlternativeId);
      if (!alt) throw new StrategyActionError('positioning alternative not found');
      const oldPrimary = data.positioning.primaryStatement;
      const promotedAlt = { id: genId('pos'), label: 'Previous', statement: oldPrimary };
      const alternatives = data.positioning.alternatives
        .filter((a) => a.id !== alt.id)
        .concat(promotedAlt);
      return {
        data: { ...data, positioning: { ...data.positioning, primaryStatement: alt.statement, alternatives } },
        event: historyEvent(action, `Смена позиционирования на "${alt.label}"`, oldPrimary, alt.statement),
      };
    }

    case 'set_primary_offer': {
      const target = data.offers.find((o) => o.id === action.offerId);
      if (!target) throw new StrategyActionError('offer not found');
      const old = data.offers.find((o) => o.isPrimary)?.text ?? '';
      const offers = data.offers.map((o) => ({ ...o, isPrimary: o.id === target.id }));
      return {
        data: { ...data, offers },
        event: historyEvent(action, 'Смена основного оффера', old, target.text),
      };
    }

    case 'update_funnel_rate': {
      const idx = data.funnel.findIndex((s) => s.id === action.funnelStageId);
      if (idx === -1 || action.newRate === undefined) throw new StrategyActionError('invalid funnel action');
      const old = data.funnel[idx].conversionToNext;
      const funnel = recomputeFunnel(data.funnel, idx, action.newRate);
      return {
        data: { ...data, funnel },
        event: historyEvent(action, `Изменение конверсии "${data.funnel[idx].label}"`, `${old}%`, `${action.newRate}%`),
      };
    }

    case 'apply_risk':
    case 'apply_opportunity': {
      const list = action.type === 'apply_risk' ? data.risks : data.opportunities;
      const insight = list.find((i) => i.id === action.insightId);
      if (!insight) throw new StrategyActionError('insight not found');
      const nested = insight.action;
      let next = data;
      if (nested && nested.type !== action.type) {
        next = applyStrategyAction(data, nested).data;
      }
      const key = action.type === 'apply_risk' ? 'risks' : 'opportunities';
      next = {
        ...next,
        [key]: next[key].map((i) => (i.id === insight.id ? { ...i, status: 'applied' as const } : i)),
      };
      return { data: next, event: historyEvent(action, `Применена рекомендация "${insight.title}"`) };
    }

    case 'dismiss_insight': {
      const inRisks = data.risks.some((i) => i.id === action.insightId);
      const key = inRisks ? 'risks' : 'opportunities';
      const list = data[key];
      const insight = list.find((i) => i.id === action.insightId);
      if (!insight) throw new StrategyActionError('insight not found');
      return {
        data: { ...data, [key]: list.map((i) => (i.id === insight.id ? { ...i, status: 'dismissed' as const } : i)) },
        event: historyEvent(action, `Скрыта рекомендация "${insight.title}"`),
      };
    }

    default:
      throw new StrategyActionError(`unknown action type`);
  }
}
