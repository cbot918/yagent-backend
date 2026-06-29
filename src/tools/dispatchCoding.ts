import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { bus } from '../events.js';
import { getCodingAgent } from '../coding-agent/index.js';
import { budgetGate, recordUsage } from '../usage/index.js';
import type { Tool } from './types.js';

/**
 * The orchestrator's "delegate heavy coding" capability. Blocks until the
 * external harness finishes and returns the final diff/summary to the loop
 * (so it fits yagent's `Tool.run(): Promise<string>` contract unchanged),
 * while streaming progress to the bus as `dispatch:*` events for the UI.
 *
 * Routing is implicit: the orchestrator LLM decides when to call this.
 */
export const dispatchCodingTool: Tool = {
  name: 'dispatch_coding_task',
  description:
    'Delegate a heavy coding task to an external coding agent (Claude Code / opencode). ' +
    'Give a precise, self-contained spec; it returns the final diff/summary. ' +
    'Use for multi-file edits, building features, running/fixing code — not for quick questions you can answer yourself.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Precise, self-contained instruction/spec for the coding agent.' },
      context: { type: 'string', description: 'Optional extra context (project facts, constraints) to prepend.' },
      cwd: {
        type: 'string',
        description: 'Optional working directory (absolute, or relative to the workspace). Defaults to the workspace.',
      },
      agent: {
        type: 'string',
        enum: ['claude', 'opencode'],
        description: 'Which coding agent to use. Defaults to the configured CODING_AGENT.',
      },
    },
    required: ['task'],
  },
  async run(args, ctx) {
    const { task, context, cwd, agent } = args as {
      task: string;
      context?: string;
      cwd?: string;
      agent?: string;
    };

    const resolvedCwd = cwd
      ? path.isAbsolute(cwd)
        ? cwd
        : path.resolve(ctx.workspaceDir, cwd)
      : ctx.workspaceDir;

    const codingAgent = getCodingAgent(agent || ctx.codingAgent || config.codingAgent);
    // Attribute harness spend: Claude rides the subscription; opencode rides OpenRouter.
    const provider = codingAgent.name === 'claude' ? 'claude-subscription' : 'openrouter';
    const keyId = codingAgent.name === 'claude' ? 'claude' : 'openrouter';

    const blocked = await budgetGate({ provider, keyId, roleId: ctx.roleId });
    if (blocked.length > 0) {
      const b = blocked[0];
      return `[budget] Coding-agent dispatch blocked: over the ${b.budget.scope}${b.budget.match ? ` "${b.budget.match}"` : ''} limit ($${b.usedUSD.toFixed(2)} / $${b.limitUSD.toFixed(2)}). Raise it in billing.json.`;
    }

    const taskId = randomUUID();
    const base = { sessionKey: ctx.sessionKey, channel: ctx.channel };

    bus.emitEvent({
      type: 'dispatch:start',
      taskId,
      agent: codingAgent.name,
      task,
      cwd: resolvedCwd,
      ts: Date.now(),
      ...base,
    });

    const result = await codingAgent.run({ prompt: task, context, cwd: resolvedCwd }, (e) =>
      bus.emitEvent({ type: 'dispatch:event', taskId, kind: e.kind, text: e.text, ts: Date.now(), ...base }),
    );

    bus.emitEvent({
      type: 'dispatch:end',
      taskId,
      summary: result.summary,
      costUSD: result.costUSD,
      isError: result.isError,
      exitCode: result.exitCode,
      ts: Date.now(),
      ...base,
    });

    // Meter the harness spend (Claude reports total_cost_usd; opencode may not).
    await recordUsage(
      {
        ts: Date.now(),
        sessionKey: ctx.sessionKey,
        roleId: ctx.roleId,
        source: 'coding-agent',
        provider,
        keyId,
        model: codingAgent.name,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        costUSD: result.costUSD ?? 0,
      },
      { channel: ctx.channel },
    );

    const costLine = result.costUSD != null ? `\n\n[cost: $${result.costUSD.toFixed(4)}]` : '';
    const status = result.isError ? '[coding agent reported an error]\n\n' : '';
    return `${status}${result.summary}${costLine}`;
  },
};
