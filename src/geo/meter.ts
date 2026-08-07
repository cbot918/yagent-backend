import type OpenAI from 'openai';
import { config } from '../config.js';
import { recordUsage, loadBilling, computeLlmCost } from '../usage/index.js';

/** Provider/key the GEO job bills against (all probes route via OpenRouter). */
export const GEO_PROVIDER = config.openaiBaseUrl.includes('openrouter') ? 'openrouter' : 'openai';

/**
 * Meter one chat-completion the same way the room orchestrator does: read the
 * usage off the response, price it from billing.json, append to the ledger and
 * emit cost:update. Returns the USD cost so the caller can sum the run total.
 * Attributed to the `geo:<id>` session, no role (GEO is a job, not a role).
 */
export async function meterCompletion(
  sessionKey: string,
  model: string,
  res: OpenAI.Chat.ChatCompletion,
): Promise<number> {
  if (!res.usage) return 0;
  const { pricing } = await loadBilling();
  const costUSD = computeLlmCost(pricing, model, res.usage.prompt_tokens, res.usage.completion_tokens);
  await recordUsage(
    {
      ts: Date.now(),
      sessionKey,
      source: 'llm',
      provider: GEO_PROVIDER,
      keyId: GEO_PROVIDER,
      model,
      inputTokens: res.usage.prompt_tokens,
      outputTokens: res.usage.completion_tokens,
      costUSD,
    },
    { channel: 'web' },
  );
  return costUSD;
}
