import { spawn } from 'child_process';
import { config } from '../config.js';
import { track } from './runtime.js';
import type { CodingAgent, CodingResult, NormalizedEvent } from './types.js';

/**
 * Claude Code adapter. Spawns `claude -p ... --output-format stream-json`,
 * which emits NDJSON: a `system/init` line, then `assistant` messages
 * (content[] of text/tool_use), then a final `result` line carrying the
 * summary, `total_cost_usd`, and token `usage`.
 *
 * Shape verified against Claude Code v2.1.183.
 */
export function createClaudeAdapter(): CodingAgent {
  return {
    name: 'claude',
    run(task, onEvent) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose'];
      if (config.claudeModel) args.push('--model', config.claudeModel);
      // Headless autonomy: no TTY to answer permission prompts, so allow the
      // harness to act. Self-use only; disable with CLAUDE_YOLO=false.
      if (config.claudeYolo) args.push('--dangerously-skip-permissions');
      const prompt = task.context ? `${task.context}\n\n---\n\n${task.prompt}` : task.prompt;
      args.push(prompt);

      return new Promise<CodingResult>((resolve) => {
        const child = spawn(config.claudeBin, args, { cwd: task.cwd, env: process.env });
        track(child, task.sessionKey);
        // Prompt is passed as an arg; close stdin so the CLI doesn't wait ~3s
        // for piped input before starting.
        child.stdin?.end();

        let summary = '';
        let costUSD: number | undefined;
        let usage: CodingResult['usage'];
        let isError = false;
        let buf = '';

        const handleLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let evt: any;
          try {
            evt = JSON.parse(trimmed);
          } catch {
            onEvent({ kind: 'status', text: trimmed });
            return;
          }
          switch (evt.type) {
            case 'assistant': {
              for (const c of evt.message?.content ?? []) {
                if (c.type === 'text' && c.text) onEvent({ kind: 'text', text: c.text });
                else if (c.type === 'tool_use')
                  onEvent({ kind: 'tool', text: `${c.name}(${JSON.stringify(c.input ?? {})})` });
              }
              break;
            }
            case 'result': {
              isError = !!evt.is_error;
              if (typeof evt.result === 'string') summary = evt.result;
              if (typeof evt.total_cost_usd === 'number') costUSD = evt.total_cost_usd;
              if (evt.usage)
                usage = { inputTokens: evt.usage.input_tokens, outputTokens: evt.usage.output_tokens };
              break;
            }
            case 'system': {
              if (evt.subtype && evt.subtype !== 'init') onEvent({ kind: 'status', text: String(evt.subtype) });
              break;
            }
          }
        };

        child.stdout.on('data', (d: Buffer) => {
          buf += d.toString();
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
          resolve({ summary: `Failed to launch claude: ${err.message}`, isError: true, exitCode: -1 });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (buf.trim()) handleLine(buf);
          resolve({
            summary: summary || '(no result returned)',
            isError: isError || code !== 0,
            costUSD,
            usage,
            exitCode: code ?? -1,
          });
        });
      });
    },
  };
}
