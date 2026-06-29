import { config } from '../config.js';
import { createClaudeAdapter } from './claude.js';
import { createOpencodeAdapter } from './opencode.js';
import { killAll } from './runtime.js';
import type { CodingAgent } from './types.js';

export type { CodingAgent, CodingTask, CodingResult, NormalizedEvent } from './types.js';

/**
 * Select a coding harness by id. Mirrors `sandbox/getExecutor()`: switch +
 * cache + shutdown cleanup. Pass an explicit `name` (e.g. from a role) to
 * override the `CODING_AGENT` default — that's how different virtual-company
 * members can be backed by different harnesses.
 */
const cache = new Map<string, CodingAgent>();
let cleanupInstalled = false;

export function getCodingAgent(name: string = config.codingAgent): CodingAgent {
  installCleanup();

  const cached = cache.get(name);
  if (cached) return cached;

  let agent: CodingAgent;
  switch (name) {
    case 'claude':
      agent = createClaudeAdapter();
      break;
    case 'opencode':
      agent = createOpencodeAdapter();
      break;
    default:
      throw new Error(`Unknown CODING_AGENT="${name}" (expected claude | opencode)`);
  }

  cache.set(name, agent);
  return agent;
}

function installCleanup() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => killAll());
  }
  process.once('beforeExit', () => killAll());
}
