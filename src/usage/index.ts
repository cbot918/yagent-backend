import { bus } from '../events.js';
import { loadBilling } from './billing.js';
import { appendUsage, readUsage } from './ledger.js';
import type { Budget, BudgetStatus, UsageEntry } from './types.js';

export type { UsageEntry, Budget, BudgetStatus, KeyAccount, BillingConfig } from './types.js';
export { loadBilling, computeLlmCost } from './billing.js';
export { readUsage, summarize } from './ledger.js';

const DAY_MS = 86_400_000;

/** Does a budget govern spend with this provider/key/role? */
function appliesTo(b: Budget, e: { provider: string; keyId: string; roleId?: string }): boolean {
  switch (b.scope) {
    case 'global':
      return true;
    case 'provider':
      return b.match === e.provider;
    case 'key':
      return b.match === e.keyId;
    case 'role':
      return b.match === e.roleId;
    default:
      return false;
  }
}

/** Current standing of every budget against the rolling ledger. */
export async function evaluateBudgets(budgets: Budget[]): Promise<BudgetStatus[]> {
  const now = Date.now();
  const out: BudgetStatus[] = [];
  for (const b of budgets) {
    const since = now - (b.periodDays || 30) * DAY_MS;
    const entries = await readUsage(since);
    const mine = entries.filter((e) => appliesTo(b, e));

    const usedUSD = mine.reduce((a, e) => a + e.costUSD, 0);
    const usedTokens = mine.reduce((a, e) => a + (e.inputTokens ?? 0) + (e.outputTokens ?? 0), 0);

    // A cap only counts if it was configured — otherwise a budget with just a token cap
    // would read as "0 USD used of 0 USD" and be permanently exceeded.
    const limitUSD = b.limitUSD ?? 0;
    const limitTokens = b.limitTokens ?? 0;
    const overUSD = b.limitUSD != null && usedUSD >= b.limitUSD;
    const overTokens = b.limitTokens != null && usedTokens >= b.limitTokens;

    out.push({
      budget: b,
      usedUSD,
      limitUSD,
      usedTokens,
      limitTokens,
      exceeded: overUSD || overTokens,
      exceededBy: overUSD ? 'usd' : overTokens ? 'tokens' : undefined,
    });
  }
  return out;
}

/**
 * Pre-call enforcement: returns the exceeded budgets that would govern an
 * upcoming spend. Empty = clear to proceed.
 */
export async function budgetGate(e: { provider: string; keyId: string; roleId?: string }): Promise<BudgetStatus[]> {
  const { budgets } = await loadBilling();
  const statuses = await evaluateBudgets(budgets);
  return statuses.filter((s) => s.exceeded && appliesTo(s.budget, e));
}

/** Record a spend: append to ledger, emit cost:update, alert on any breach. */
export async function recordUsage(entry: UsageEntry, meta: { channel: string }): Promise<void> {
  await appendUsage(entry);
  bus.emitEvent({
    type: 'cost:update',
    entry,
    sessionKey: entry.sessionKey,
    channel: meta.channel,
    roleId: entry.roleId,
    ts: Date.now(),
  });

  const { budgets } = await loadBilling();
  const statuses = await evaluateBudgets(budgets);
  for (const s of statuses) {
    if (s.exceeded && appliesTo(s.budget, entry)) {
      bus.emitEvent({
        type: 'budget:alert',
        budgetId: s.budget.id,
        scope: s.budget.scope,
        match: s.budget.match,
        usedUSD: s.usedUSD,
        limitUSD: s.limitUSD,
        sessionKey: entry.sessionKey,
        channel: meta.channel,
        roleId: entry.roleId,
        ts: Date.now(),
      });
    }
  }
}

/**
 * Human-readable "how far over" for a tripped budget. A token-capped budget printed as
 * dollars reads "$0.00 / $0.00", which tells the user nothing about why they were stopped.
 */
export function describeBudget(s: BudgetStatus): string {
  const who = `${s.budget.scope}${s.budget.match ? ` "${s.budget.match}"` : ''}`;
  // Report in the unit the budget is actually configured in — a token-only budget shown as
  // "$2.46 / $0.00" looks like a misconfiguration rather than headroom.
  const useTokens = s.exceededBy === 'tokens' || (s.exceededBy !== 'usd' && s.budget.limitTokens != null);
  const amount = useTokens
    ? `${s.usedTokens.toLocaleString()} / ${s.limitTokens.toLocaleString()} tokens`
    : `$${s.usedUSD.toFixed(2)} / $${s.limitUSD.toFixed(2)}`;
  return `${who} limit: ${amount} (last ${s.budget.periodDays}d)`;
}
