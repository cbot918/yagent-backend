/**
 * Cost/usage metering types. Every LLM call (orchestrator) and every coding
 * harness dispatch appends a UsageEntry to the ledger; budgets are evaluated
 * against the rolling sum so spend is observable and cappable.
 */
export interface UsageEntry {
  ts: number;
  sessionKey: string;
  roleId?: string;
  /** Where the spend came from. */
  source: 'llm' | 'coding-agent';
  /** 'openrouter' | 'openai' | 'claude-subscription' | … */
  provider: string;
  /** Which configured key/subscription was used (matches billing.json). */
  keyId: string;
  /** Model id (orchestrator) or harness id (coding agent). */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUSD: number;
}

/** A subscription or API key the user is paying for — shown on the dashboard. */
export interface KeyAccount {
  id: string;
  provider: string;
  label: string;
  /** Env var holding the credential (so the UI can show "configured?"). */
  env?: string;
}

export interface Budget {
  id: string;
  /** What the limit applies to. */
  scope: 'global' | 'provider' | 'key' | 'role';
  /** The value to match (provider name / keyId / roleId). Ignored for global. */
  match?: string;
  /** Money cap. Omit when the account isn't billed per token (see `limitTokens`). */
  limitUSD?: number;
  /**
   * Token cap (input + output) for the same window. Use this instead of `limitUSD` for a
   * flat-rate subscription — Claude/Codex plans bill an allowance, not per token, so their
   * per-call USD is either 0 or a made-up number and a money cap would never fire.
   * Both may be set; whichever is hit first trips the budget.
   */
  limitTokens?: number;
  /** Rolling window in days. */
  periodDays: number;
}

export interface PriceRate {
  inUSDPerM: number;
  outUSDPerM: number;
}

export interface BillingConfig {
  keys: KeyAccount[];
  budgets: Budget[];
  /** Token pricing by model id (exact or substring match), with 'default'. */
  pricing: Record<string, PriceRate>;
}

/** A budget's current standing — used for both the dashboard and enforcement. */
export interface BudgetStatus {
  budget: Budget;
  usedUSD: number;
  /** 0 when the budget is token-only (no money cap configured). */
  limitUSD: number;
  usedTokens: number;
  /** 0 when the budget has no token cap. */
  limitTokens: number;
  /** Either configured cap reached. */
  exceeded: boolean;
  /** Which cap tripped — for a message that names the real reason. */
  exceededBy?: 'usd' | 'tokens';
}
