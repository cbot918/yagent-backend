import fs from 'fs/promises';
import path from 'path';
import type { BillingConfig, PriceRate } from './types.js';

// Subscriptions/keys, budgets, and token pricing live as data so the user can
// edit them (and the web UI can render/edit them) without a code change.
const BILLING_FILE = path.resolve('./billing.json');

const DEFAULT_BILLING: BillingConfig = {
  keys: [
    { id: 'openrouter', provider: 'openrouter', label: 'OpenRouter (orchestrator)', env: 'OPENROUTER_API_KEY' },
    { id: 'openai', provider: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY' },
    { id: 'claude', provider: 'claude-subscription', label: 'Claude (subscription)' },
  ],
  budgets: [{ id: 'global', scope: 'global', limitUSD: 50, periodDays: 30 }],
  pricing: {
    'gpt-4o-mini': { inUSDPerM: 0.15, outUSDPerM: 0.6 },
    'google/gemini-2.0-flash': { inUSDPerM: 0.1, outUSDPerM: 0.4 },
    'google/gemini-flash': { inUSDPerM: 0.1, outUSDPerM: 0.4 },
    default: { inUSDPerM: 0, outUSDPerM: 0 },
  },
};

export async function loadBilling(): Promise<BillingConfig> {
  try {
    const raw = await fs.readFile(BILLING_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BillingConfig>;
    return {
      keys: parsed.keys ?? DEFAULT_BILLING.keys,
      budgets: parsed.budgets ?? DEFAULT_BILLING.budgets,
      pricing: parsed.pricing ?? DEFAULT_BILLING.pricing,
    };
  } catch {
    return DEFAULT_BILLING;
  }
}

/** Look up a price rate by exact id, then substring, then 'default'. */
function rateFor(pricing: Record<string, PriceRate>, model: string): PriceRate {
  if (pricing[model]) return pricing[model];
  for (const [key, rate] of Object.entries(pricing)) {
    if (key !== 'default' && model.includes(key)) return rate;
  }
  return pricing.default ?? { inUSDPerM: 0, outUSDPerM: 0 };
}

/** Compute USD cost for an orchestrator LLM call from token counts. */
export function computeLlmCost(
  pricing: Record<string, PriceRate>,
  model: string,
  inputTokens = 0,
  outputTokens = 0,
): number {
  const rate = rateFor(pricing, model);
  return (inputTokens / 1_000_000) * rate.inUSDPerM + (outputTokens / 1_000_000) * rate.outUSDPerM;
}
