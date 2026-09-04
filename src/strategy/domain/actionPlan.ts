// spec §34 — the 30-day plan template. Deliberately a fixed learning-loop structure (not
// AI-authored line items) filled in with references to the strategy's own top entities, so it
// never invents a plan the rest of the strategy doesn't support.

import { genId } from './ids';
import type { ActionPlanTask, StrategyV4 } from './types';

export function buildActionPlan(strategy: StrategyV4): ActionPlanTask[] {
  const primaryOffer = strategy.offers.find((o) => o.isPrimary) ?? strategy.offers[0];
  const topSegment = strategy.segments.find((s) => s.priority === 'now') ?? strategy.segments[0];
  const topChannels = strategy.channels.slice(0, 2).map((c) => c.channel).join(', ') || 'приоритетные каналы';

  const tasks: Omit<ActionPlanTask, 'id' | 'done'>[] = [
    {
      week: 1,
      goal: 'Проверить сообщения',
      action: primaryOffer ? `3 оффера × 3 креатива на основе "${primaryOffer.promise}"` : '3 оффера × 3 креатива',
      expectedResult: 'Определить сильнейший message',
      status: 'no_data',
    },
    {
      week: 2,
      goal: 'Проверить аудитории',
      action: topSegment ? `Запустить 2-3 сегмента, начиная с "${topSegment.name}"` : 'Запустить 2-3 сегмента',
      expectedResult: 'Определить лучший qualified response',
      status: 'no_data',
    },
    {
      week: 3,
      goal: 'Усилить победителя',
      action: `Создать больше вариантов winner на каналах: ${topChannels}`,
      expectedResult: 'Проверить устойчивость результата',
      status: 'no_data',
    },
    {
      week: 4,
      goal: 'Масштабировать / уточнить',
      action: 'Перенести бюджет + новый эксперимент',
      expectedResult: 'Обновить стратегию на фактах',
      status: 'no_data',
    },
  ];

  return tasks.map((task) => ({ ...task, id: genId('task'), done: false }));
}
