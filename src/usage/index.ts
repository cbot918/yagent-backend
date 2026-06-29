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
    const usedUSD = entries
      .filter((e) => appliesTo(b, e))
      .reduce((a, e) => a + e.costUSD, 0);
    out.push({ budget: b, usedUSD, limitUSD: b.limitUSD, exceeded: usedUSD >= b.limitUSD });
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
