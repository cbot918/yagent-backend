import { config } from '../config.js';
import { getExecutor } from '../sandbox/index.js';
import type { Tool } from './types.js';

const MAX_OUTPUT = 8000; // chars returned to the model

function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT) + '\n…[truncated]', truncated: true };
}

export const shellTool: Tool = {
  name: 'shell',
  description:
    'Run a shell command in a sandboxed environment (requires ALLOW_SHELL=true). ' +
    'State persists between commands within a session. Network may be disabled depending on configuration.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
    },
    required: ['command'],
  },
  async run(args, ctx) {
    const { command } = args as { command: string };
    const result = await getExecutor().exec(ctx.sessionKey, command, { timeoutMs: config.shellTimeoutMs });

    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const { text, truncated } = clip(combined);
    const parts: string[] = [];
    if (result.exitCode !== 0) parts.push(`(exit code ${result.exitCode})`);
    parts.push(text || '(no output)');
    if (truncated) parts.push('[output truncated]');
    return parts.join('\n');
  },
};
