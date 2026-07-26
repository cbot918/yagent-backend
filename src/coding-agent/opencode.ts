import { spawn } from 'child_process';
import { config } from '../config.js';
import { track } from './runtime.js';
import type { CodingAgent, CodingResult } from './types.js';

/**
 * opencode adapter — proves the harness is swappable. Spawns
 * `opencode run -m <provider/model> "<prompt>"` (non-interactive). Point it at
 * OpenRouter via OPENCODE_MODEL=openrouter/<model> + OPENROUTER_API_KEY.
 *
 * opencode prints the assistant result to stdout as plain text (no per-call
 * cost in the CLI output today), so this adapter streams lines as `text`
 * events and leaves `costUSD` undefined. If a future opencode version adds a
 * structured/JSON output, parse it here — the interface doesn't change.
 */
export function createOpencodeAdapter(): CodingAgent {
  return {
    name: 'opencode',
    run(task, onEvent) {
      const args = ['run'];
      if (config.opencodeModel) args.push('-m', config.opencodeModel);
      const prompt = task.context ? `${task.context}\n\n---\n\n${task.prompt}` : task.prompt;
      args.push(prompt);

      const env = { ...process.env };
      if (config.openrouterApiKey) env.OPENROUTER_API_KEY = config.openrouterApiKey;

      return new Promise<CodingResult>((resolve) => {
        const child = spawn(config.opencodeBin, args, { cwd: task.cwd, env });
        track(child, task.sessionKey);
        child.stdin?.end();

        let out = '';
        let buf = '';

        child.stdout.on('data', (d: Buffer) => {
          const s = d.toString();
          out += s;
          buf += s;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const l of lines) if (l.trim()) onEvent({ kind: 'text', text: l });
        });
        child.stderr.on('data', (d: Buffer) => {
          const t = d.toString().trim();
          if (t) onEvent({ kind: 'status', text: t });
        });

        const timer = setTimeout(() => {
          onEvent({ kind: 'error', text: 'coding agent timed out' });
          child.kill('SIGKILL');
        }, config.codingAgentTimeoutMs);

        child.on('error', (err) => {
          clearTimeout(timer);
          resolve({ summary: `Failed to launch opencode: ${err.message}`, isError: true, exitCode: -1 });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (buf.trim()) onEvent({ kind: 'text', text: buf });
          resolve({ summary: out.trim() || '(no output)', isError: code !== 0, exitCode: code ?? -1 });
        });
      });
    },
  };
}
