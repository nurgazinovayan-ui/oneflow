// spec §36 — Strategy readiness replaces the raw "82/100" Strategy Score as the default state.

import type { Readiness, StrategyV4 } from './types';

export function computeReadiness(strategy: StrategyV4): Readiness {
  const businessUnderstood = Boolean(strategy.businessUnderstanding?.confirmed);
  const audienceSelected = strategy.segments.some((s) => s.priority === 'now');
  const offersReady = strategy.offers.length >= 3;
  const creativePlanReady = strategy.creativeCards.length > 0;

  const items = [
    { label: 'Бизнес понятен', done: businessUnderstood },
    { label: 'Основная аудитория выбрана', done: audienceSelected },
    { label: '3 offer-гипотезы готовы', done: offersReady },
    { label: 'Creative plan готов', done: creativePlanReady },
  ];

  const blockers: Readiness['blockers'] = [];
  const hasCampaignData = strategy.experiments.some((e) => e.result);
  if (!hasCampaignData) blockers.push({ label: 'Нет данных рекламных кампаний', actionLabel: 'Подключить рекламу' });
  const hasProductAnalytics = strategy.economics.cac.value !== undefined;
  if (!hasProductAnalytics) blockers.push({ label: 'Не подключена продуктовая аналитика' });

  const allCoreReady = items.every((i) => i.done);
  const nextStepLabel = !businessUnderstood
    ? 'Подтвердить понимание бизнеса'
    : !audienceSelected
      ? 'Выбрать основную аудиторию'
      : !offersReady
        ? 'Сгенерировать offer-гипотезы'
        : !creativePlanReady
          ? 'Собрать creative plan'
          : allCoreReady
            ? 'Создать первый эксперимент'
            : 'Продолжить настройку стратегии';

  return { items, blockers, nextStepLabel };
}
