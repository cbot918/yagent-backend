import { config } from '../config.js';
import { hostExecutor } from './host.js';
import { createDockerExecutor } from './docker.js';
import { createE2BExecutor } from './e2b.js';
import type { Executor } from './types.js';

export type { Executor, ExecResult } from './types.js';

let executor: Executor | null = null;

export function getExecutor(): Executor {
  if (executor) return executor;

  switch (config.shellBackend) {
    case 'docker':
      executor = createDockerExecutor();
      break;
    case 'e2b':
      executor = createE2BExecutor();
      break;
    case 'host':
      executor = hostExecutor;
      break;
    default:
      throw new Error(`Unknown SHELL_BACKEND="${config.shellBackend}" (expected host | docker | e2b)`);
  }

  // Best-effort cleanup of any per-session sandboxes on shutdown.
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    await executor!.disposeAll().catch(() => {});
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => void cleanup().finally(() => process.exit(0)));
  }
  process.once('beforeExit', () => void cleanup());

  return executor;
}
