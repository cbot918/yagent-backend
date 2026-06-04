import { config } from '../config.js';
import type { Executor, ExecOptions, ExecResult } from './types.js';

// The e2b SDK is an optional dependency loaded only when this backend is used,
// and typed loosely so we don't couple the build to a specific SDK version.
interface E2BCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}
interface E2BSandbox {
  commands: { run(cmd: string, opts?: { timeoutMs?: number }): Promise<E2BCommandResult> };
  kill(): Promise<void>;
}
interface E2BModule {
  Sandbox: { create(opts?: { apiKey?: string }): Promise<E2BSandbox> };
}

export function createE2BExecutor(): Executor {
  const sandboxes = new Map<string, Promise<E2BSandbox>>();

  async function loadSdk(): Promise<E2BModule> {
    try {
      return (await import('e2b')) as unknown as E2BModule;
    } catch {
      throw new Error("SHELL_BACKEND=e2b but the 'e2b' package is not installed. Run `npm install e2b`.");
    }
  }

  function getSandbox(sessionKey: string): Promise<E2BSandbox> {
    let sb = sandboxes.get(sessionKey);
    if (!sb) {
      if (!config.e2bApiKey) {
        return Promise.reject(new Error('SHELL_BACKEND=e2b requires E2B_API_KEY to be set.'));
      }
      sb = loadSdk().then((m) => m.Sandbox.create({ apiKey: config.e2bApiKey }));
      sandboxes.set(sessionKey, sb);
    }
    return sb;
  }

  return {
    name: 'e2b',

    async exec(sessionKey, command, opts: ExecOptions): Promise<ExecResult> {
      try {
        const sandbox = await getSandbox(sessionKey);
        const r = await sandbox.commands.run(command, { timeoutMs: opts.timeoutMs });
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0, truncated: false };
      } catch (err) {
        return { stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1, truncated: false };
      }
    },

    async dispose(sessionKey) {
      const sb = sandboxes.get(sessionKey);
      if (!sb) return;
      sandboxes.delete(sessionKey);
      await sb.then((s) => s.kill()).catch(() => {});
    },

    async disposeAll() {
      await Promise.all([...sandboxes.keys()].map((k) => this.dispose(k)));
    },
  };
}
