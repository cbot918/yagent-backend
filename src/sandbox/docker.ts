import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { config } from '../config.js';
import type { Executor, ExecOptions, ExecResult } from './types.js';

const execFileAsync = promisify(execFile);

function containerName(sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200);
  return `yagent-sbx-${safe}`;
}

let dockerCheck: Promise<void> | null = null;
function ensureDockerAvailable(): Promise<void> {
  if (!dockerCheck) {
    dockerCheck = execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'])
      .then(() => undefined)
      .catch(() => {
        throw new Error(
          'SHELL_BACKEND=docker but Docker is not available (is the daemon running?). ' +
            'Install/start Docker, or set SHELL_BACKEND=e2b (managed sandbox) or =host (dev only).',
        );
      });
  }
  return dockerCheck;
}

/**
 * Runs a `docker` CLI invocation, capturing output and enforcing a timeout by
 * killing the CLI process if it overruns.
 */
function runDocker(args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), exitCode: 1, truncated: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) stderr += `\n[sandbox] command timed out after ${timeoutMs}ms`;
      resolve({ stdout, stderr, exitCode: timedOut ? 124 : code ?? 1, truncated: false });
    });
  });
}

export function createDockerExecutor(): Executor {
  // Dedupe concurrent container creation per session.
  const starting = new Map<string, Promise<void>>();
  const live = new Set<string>();

  async function ensureContainer(sessionKey: string): Promise<void> {
    await ensureDockerAvailable();
    if (live.has(sessionKey)) return;
    let p = starting.get(sessionKey);
    if (!p) {
      p = (async () => {
        const name = containerName(sessionKey);
        // Remove any stale container with the same name, then start a hardened one.
        await execFileAsync('docker', ['rm', '-f', name]).catch(() => {});
        await execFileAsync('docker', [
          'run',
          '-d',
          '--rm',
          '--name', name,
          '--network', config.sandboxNetwork,
          '--memory', config.sandboxMemory,
          '--cpus', String(config.sandboxCpus),
          '--pids-limit', '256',
          '--cap-drop', 'ALL',
          '--security-opt', 'no-new-privileges',
          '--read-only',
          '--tmpfs', '/tmp:rw,size=64m',
          '-v', `${config.workspaceDir}:/workspace`,
          '-w', '/workspace',
          config.sandboxImage,
          'sleep', 'infinity',
        ]);
        live.add(sessionKey);
      })().finally(() => starting.delete(sessionKey));
      starting.set(sessionKey, p);
    }
    await p;
  }

  return {
    name: 'docker',

    async exec(sessionKey, command, opts: ExecOptions): Promise<ExecResult> {
      await ensureContainer(sessionKey);
      const name = containerName(sessionKey);
      const result = await runDocker(['exec', name, 'sh', '-c', command], opts.timeoutMs);
      // If the container died (e.g. OOM-killed), reset so the next call rebuilds it.
      if (/is not running|No such container/i.test(result.stderr)) live.delete(sessionKey);
      return result;
    },

    async dispose(sessionKey) {
      if (!live.has(sessionKey)) return;
      live.delete(sessionKey);
      await execFileAsync('docker', ['rm', '-f', containerName(sessionKey)]).catch(() => {});
    },

    async disposeAll() {
      await Promise.all([...live].map((k) => this.dispose(k)));
    },
  };
}
