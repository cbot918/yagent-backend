import { spawn } from 'child_process';
import { config } from '../config.js';
import { track } from './runtime.js';
import type { CodingAgent, CodingResult, NormalizedEvent } from './types.js';

/**
 * Codex adapter — the third swappable harness, used by the QA role so testing spend sits on
 * a separate account from engineering's. Spawns `codex exec "<prompt>"` (non-interactive).
 *
 * Flags verified against codex-cli 0.145.0: `-m/--model`, `-s/--sandbox`, `--json`,
 * `--skip-git-repo-check` all exist. We set the child's `cwd` rather than passing `-C/--cd`
 * (equivalent, and one less flag to keep in sync), and stay on plain stdout unless
 * `CODEX_JSON=true`. If a future CLI changes shape, this file is the only thing to touch —
 * the `CodingAgent` interface stays put.
 *
 * Cost: plain-text mode reports none, so `costUSD` is left undefined. In JSON mode we pick up
 * token counts when they appear. Anything the harness doesn't report cannot be enforced by
 * `budgetGate()` — a per-role budget on Codex is only as real as what lands here.
 */
export function createCodexAdapter(): CodingAgent {
  return {
    name: 'codex',
    run(task, onEvent) {
      const args = ['exec'];
      if (config.codexModel) args.push('-m', config.codexModel);
      // `codex exec` is already non-interactive; the sandbox policy is what decides how far
      // it may reach. Note there is no `--full-auto` here — that is Claude Code's flag.
      if (config.codexSandbox) args.push('--sandbox', config.codexSandbox);
      if (config.codexSkipGitCheck) args.push('--skip-git-repo-check');
      if (config.codexJson) args.push('--json');
      const prompt = task.context ? `${task.context}\n\n---\n\n${task.prompt}` : task.prompt;
      args.push(prompt);

      return new Promise<CodingResult>((resolve) => {
        const child = spawn(config.codexBin, args, { cwd: task.cwd, env: { ...process.env } });
        track(child, task.sessionKey);
        child.stdin?.end();

        let out = '';
        let buf = '';
        let usage: CodingResult['usage'];
        let lastMessage = '';
        let failure = '';

        const handleLine = (line: string) => {
          if (!line.trim()) return;
          if (!config.codexJson) {
            onEvent({ kind: 'text', text: line });
            return;
          }
          // JSON mode: one event per line. Unknown/!JSON lines still reach the model as text
          // rather than being swallowed — a harness that changed its format should be visible.
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line);
          } catch {
            onEvent({ kind: 'text', text: line });
            return;
          }
          // Real 0.145 event shapes:
          //   {"type":"item.completed","item":{"type":"agent_message","text":"…"}}
          //   {"type":"item.completed","item":{"type":"error","message":"…"}}
          //   {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N}}
          //   {"type":"turn.failed","error":{"message":"…"}}  |  {"type":"error","message":"…"}
          const u = (evt.usage ?? evt.token_count) as
            | { input_tokens?: number; output_tokens?: number }
            | undefined;
          if (u) {
            usage = {
              inputTokens: u.input_tokens ?? usage?.inputTokens,
              outputTokens: u.output_tokens ?? usage?.outputTokens,
            };
          }

          const item = evt.item as { type?: string; text?: string; message?: string } | undefined;
          const errText =
            (typeof evt.message === 'string' ? evt.message : undefined) ??
            (evt.error as { message?: string } | undefined)?.message ??
            (item?.type === 'error' ? item.message : undefined);

          if (errText) {
            // A model/plan rejection arrives here, not as a non-zero exit — keep it for the summary
            // so the caller sees why, instead of an empty result.
            failure = errText;
            onEvent({ kind: 'error', text: errText });
            return;
          }

          const text = item?.text ?? (typeof evt.text === 'string' ? evt.text : '');
          if (text) {
            if (item?.type === 'agent_message') lastMessage = text;
            onEvent({ kind: 'text', text });
          }
        };

        child.stdout.on('data', (d: Buffer) => {
          const s = d.toString();
          out += s;
          buf += s;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const l of lines) handleLine(l);
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
          resolve({ summary: `Failed to launch codex: ${err.message}`, isError: true, exitCode: -1 });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (buf.trim()) handleLine(buf);
          // In JSON mode the raw stream is NDJSON — returning it whole would dump machine
          // noise into the orchestrator's context. Prefer the final agent message; fall back
          // to the failure text, because codex reports model/plan rejections with exit 0.
          const summary = config.codexJson
            ? lastMessage || failure || out.trim() || '(no output)'
            : out.trim() || '(no output)';
          resolve({
            summary,
            isError: code !== 0 || Boolean(failure),
            usage,
            exitCode: code ?? -1,
          });
        });
      });
    },
  };
}
