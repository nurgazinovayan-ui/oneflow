import type { MarketingAIResponse, MarketingAITask } from '../../types';

export class MarketingAIError extends Error {}

/** Thin wrapper over window.api.marketingAI — every service module in this directory calls through here. */
export async function callMarketingAI(task: MarketingAITask, context: Record<string, unknown>, mock = false): Promise<unknown> {
  let response: MarketingAIResponse;
  try {
    response = await window.api.marketingAI(task, context, mock);
  } catch (err) {
    throw new MarketingAIError(err instanceof Error ? err.message : String(err));
  }
  return response.result;
}
