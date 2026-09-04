import type { BusinessUnderstanding } from '../domain/types';
import { buildContext, type StrategyContextInput } from './contextBuilder';
import { callMarketingAI } from './aiClient';
import { asRecord, bool, str, strArr } from './normalize';

/** spec §6 Business Understanding — the pipeline's mandatory first step. */
export async function runUnderstandBusiness(input: StrategyContextInput, mock = false): Promise<BusinessUnderstanding> {
  const context = buildContext('understandBusiness', input);
  const raw = asRecord(await callMarketingAI('understandBusiness', context, mock));
  return {
    product: str(raw.product),
    category: str(raw.category),
    customerProblem: str(raw.customerProblem),
    value: str(raw.value),
    differentiators: strArr(raw.differentiators),
    businessModel: str(raw.businessModel),
    geography: str(raw.geography),
    goal: str(raw.goal),
    solvesTodayVia: str(raw.solvesTodayVia),
    mainPurchaseRisk: str(raw.mainPurchaseRisk),
    ambiguities: strArr(raw.ambiguities),
    evidenceIds: strArr(raw.evidenceIds),
    missingData: strArr(raw.missingData),
    confirmed: bool(raw.confirmed, false),
  };
}
