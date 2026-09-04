import { genId } from './ids';
import { computeReadiness } from './readiness';
import type { Economics, EconomicsMetric, StrategyV4 } from './types';

function emptyMetric(formula: string): EconomicsMetric {
  return { value: undefined, formula, missingInputs: ['no data yet'], isEstimate: true };
}

function emptyEconomics(): Economics {
  return {
    cpc: emptyMetric('CPC = adSpend / clicks'),
    cpl: emptyMetric('CPL = adSpend / leads'),
    cac: emptyMetric('CAC = acquisitionSpend / newPayingCustomers'),
    arpu: emptyMetric('ARPU = revenue / activePayingUsers'),
    ltv: emptyMetric('LTV = ARPU × avgLifetimeMonths'),
    roas: emptyMetric('ROAS = attributedRevenue / adSpend'),
    payback: emptyMetric('Payback = CAC / contributionMarginPerPeriod'),
  };
}

export interface NewStrategyInput {
  name: string;
  objective: string;
  market: string;
  budget: number;
  currency: string;
  periodMonths: number;
  locale: string;
}

export function createEmptyStrategy(input: NewStrategyInput): StrategyV4 {
  const now = Date.now();
  const strategy: StrategyV4 = {
    id: genId('strat'),
    version: 1,
    name: input.name,
    status: 'draft',
    objective: input.objective,
    market: input.market,
    locale: input.locale,
    budget: input.budget,
    currency: input.currency,
    periodMonths: input.periodMonths,
    businessUnderstanding: null,
    evidence: [],
    segments: [],
    jtbd: [],
    painTriggerBarriers: [],
    positioningOptions: [],
    offers: [],
    messaging: [],
    channels: [],
    creativeCards: [],
    funnel: [
      { key: 'saw', label: 'Увидел', isEstimate: true },
      { key: 'interested', label: 'Заинтересовался', isEstimate: true },
      { key: 'checked', label: 'Проверил', isEstimate: true },
      { key: 'tried', label: 'Попробовал', isEstimate: true },
      { key: 'bought', label: 'Купил', isEstimate: true },
      { key: 'returned', label: 'Вернулся', isEstimate: true },
    ],
    economics: emptyEconomics(),
    experiments: [],
    learnings: [],
    actionPlan: [],
    readiness: { items: [], blockers: [], nextStepLabel: '' },
    proposals: [],
    landingAudit: null,
    history: [{ id: genId('hist'), timestamp: now, type: 'generate', description: 'Стратегия создана' }],
    staleModules: [],
    createdAt: now,
    updatedAt: now,
  };
  strategy.readiness = computeReadiness(strategy);
  return strategy;
}
