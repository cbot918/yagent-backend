import { config } from '../config.js';
import { createEnsembleDataSource } from './ensembledata.js';
import { createBrowserSource } from './browser.js';
import type { ThreadsSource } from './types.js';

export type { NormalizedPost, SearchResult, ThreadsSource } from './types.js';

/**
 * The Threads-source registry — the single extension point for swappable Threads
 * backends. Add a source by adding a factory here; it becomes selectable per-role
 * in the settings UI (GET /api/threads-sources reads this). Mirrors the
 * coding-agent / sandbox Executor registry pattern.
 */
const factories: Record<string, () => ThreadsSource> = {
  ensembledata: createEnsembleDataSource,
  browser: createBrowserSource,
};

const cache = new Map<string, ThreadsSource>();

/** Names of available sources (for the settings UI / GET /api/threads-sources). */
export function listThreadsSources(): string[] {
  return Object.keys(factories);
}

export function getThreadsSource(name: string = config.threadsSource): ThreadsSource {
  const cached = cache.get(name);
  if (cached) return cached;

  const factory = factories[name];
  if (!factory) {
    throw new Error(`Unknown THREADS_SOURCE="${name}" (expected: ${listThreadsSources().join(' | ')})`);
  }
  const source = factory();
  cache.set(name, source);
  return source;
}
