import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config.js';
import type { Executor, ExecOptions, ExecResult } from './types.js';

const execAsync = promisify(execFile);

let warned = false;

/**
 * Runs commands directly on the host with cwd = workspace. NO isolation:
 * the command can read host files, reach the network, and escape the
 * workspace via absolute paths. Intended for local dev only.
 */
export const hostExecutor: Executor = {
  name: 'host',

  async exec(_sessionKey: string, command: string, opts: ExecOptions): Promise<ExecResult> {
    if (!warned) {
      console.warn('[sandbox] SHELL_BACKEND=host — shell runs UNSANDBOXED on this machine. Use docker or e2b in production.');
      warned = true;
    }
    try {
      const { stdout, stderr } = await execAsync('sh', ['-c', command], {
        cwd: config.workspaceDir,
        timeout: opts.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr, exitCode: 0, truncated: false };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? String(err),
        exitCode: typeof e.code === 'number' ? e.code : 1,
        truncated: false,
      };
    }
  },

  async dispose() {},
  async disposeAll() {},
};
