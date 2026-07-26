import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { bus } from '../events.js';
import { getCodingAgent } from '../coding-agent/index.js';
import { budgetGate, recordUsage, describeBudget } from '../usage/index.js';
import { isAborting } from '../abort.js';
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
        description:
          'Working directory (absolute, or relative to the workspace). Defaults to the workspace — which is NOT the target repo. ' +
          'When the task is about a specific project, you MUST pass that project\'s absolute path, or the harness will edit the wrong tree.',
      },
      agent: {
        type: 'string',
        enum: ['claude', 'opencode', 'codex'],
        description:
          'Which coding agent to use. IGNORED when your role is bound to a harness — that binding is what keeps each role\'s spend on its own account. If your harness fails, report the failure; do not re-dispatch to a different one.',
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

    // The role's harness wins over the model's `agent` argument. Roles are bound to a harness
    // precisely so their spend lands on separate accounts (engineer → Claude subscription,
    // qa → Codex); letting the loop pick would make that separation advisory — and it does try,
    // e.g. by retrying on Claude after its own harness errors.
    const requested = ctx.codingAgent || agent || config.codingAgent;
    const overridden = agent && ctx.codingAgent && agent !== ctx.codingAgent;
    const codingAgent = getCodingAgent(requested);
    // Attribute harness spend to its own account, so a key-scoped budget can govern it.
    // Codex used to fall into the opencode/OpenRouter bucket, which silently pooled two
    // different subscriptions under one key.
    const ATTRIBUTION: Record<string, { provider: string; keyId: string }> = {
      claude: { provider: 'claude-subscription', keyId: 'claude' },
      codex: { provider: 'codex-subscription', keyId: 'codex' },
      opencode: { provider: 'openrouter', keyId: 'openrouter' },
    };
    const { provider, keyId } = ATTRIBUTION[codingAgent.name] ?? ATTRIBUTION.opencode;

    const blocked = await budgetGate({ provider, keyId, roleId: ctx.roleId });
    if (blocked.length > 0) {
      const b = blocked[0];
      return `[budget] Coding-agent dispatch blocked: over the ${describeBudget(b)}. Raise it in billing.json.`;
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

    const result = await codingAgent.run({ prompt: task, context, cwd: resolvedCwd, sessionKey: ctx.sessionKey }, (e) =>
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

    // A killed harness looks like a crash from here; say what actually happened so the loop
    // doesn't read it as a code failure and try again.
    if (isAborting(ctx.sessionKey)) {
      return '[dispatch cancelled] The user stopped this session, so the coding agent was killed mid-run. Nothing further should be attempted.';
    }

    const costLine = result.costUSD != null ? `\n\n[cost: $${result.costUSD.toFixed(4)}]` : '';
    const status = result.isError ? '[coding agent reported an error]\n\n' : '';
    const note = overridden
      ? `\n\n[note: agent="${agent}" was ignored — your role is bound to "${ctx.codingAgent}". Report a harness failure rather than switching harnesses.]`
      : '';
    return `${status}${result.summary}${costLine}${note}`;
  },
};
