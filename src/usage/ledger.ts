import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import type { UsageEntry } from './types.js';

// Append-only ledger (files-as-truth). One JSON object per line so writes are
// cheap and crash-safe; reads parse the whole file (fine at demo scale).
function ledgerPath() {
  return path.join(config.workspaceDir, '.usage', 'ledger.jsonl');
}

export async function appendUsage(entry: UsageEntry): Promise<void> {
  const p = ledgerPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, JSON.stringify(entry) + '\n');
}

export async function readUsage(sinceTs = 0): Promise<UsageEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(ledgerPath(), 'utf8');
  } catch {
    return [];
  }
  const out: UsageEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as UsageEntry;
      if (e.ts >= sinceTs) out.push(e);
    } catch {
      /* skip a corrupt line */
    }
  }
  return out;
}

export interface UsageSummary {
  totalUSD: number;
  byProvider: Record<string, number>;
  byKey: Record<string, number>;
  byRole: Record<string, number>;
  count: number;
}

export function summarize(entries: UsageEntry[]): UsageSummary {
  const s: UsageSummary = { totalUSD: 0, byProvider: {}, byKey: {}, byRole: {}, count: entries.length };
  for (const e of entries) {
    s.totalUSD += e.costUSD;
    s.byProvider[e.provider] = (s.byProvider[e.provider] ?? 0) + e.costUSD;
    s.byKey[e.keyId] = (s.byKey[e.keyId] ?? 0) + e.costUSD;
    const role = e.roleId ?? 'unknown';
    s.byRole[role] = (s.byRole[role] ?? 0) + e.costUSD;
  }
  return s;
}
