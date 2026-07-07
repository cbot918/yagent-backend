import { randomUUID } from 'crypto';
import { bus } from '../events.js';
import { getRole } from '../roles/loader.js';
import { runTurn, MAX_DELEGATION_DEPTH } from '../agent.js';
import type { Tool, ToolRegistry } from './types.js';

/**
 * Inter-role delegation: lets one virtual-company member hand a self-contained
 * subtask to another member (by role id). The delegate runs a full turn of its
 * own — its persona, model, tool allowlist, and action mode all apply — on a
 * derived sub-session (`<caller>::<delegate>`), and its final reply comes back
 * to the caller's loop as this tool's result string (so the `Tool` contract is
 * unchanged). Bracketed with `delegate:start`/`delegate:end` bus events so the
 * caller's UI can render a sub-panel.
 *
 * Guards: depth-limited (MAX_DELEGATION_DEPTH) to stop runaway delegation
 * chains, and no self-delegation. Budget/usage are enforced and metered inside
 * runTurn under the *delegate's* role, so delegated spend is capped and tracked.
 *
 * Built as a factory so it can close over the shared ToolRegistry (the delegate
 * needs the same tools the caller had access to).
 */
export function createDelegateRoleTool(registry: ToolRegistry): Tool {
  return {
    name: 'delegate_to_role',
    description:
      'Hand a self-contained subtask to another virtual-company member (by role id) and get back their result. ' +
      'The delegate runs with its own persona, tools, and permissions, and does NOT see this conversation — give a precise, self-contained task. ' +
      'Use when the work belongs to a different specialist (e.g. a PM/CEO delegating implementation to "engineer", or asking "cfo" to price something). ' +
      'For your own hands-on coding, use dispatch_coding_task instead.',
    parameters: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description:
            'Target role id — pick from the "Virtual company roster" in your system prompt (use the id, not the display name).',
        },
        task: { type: 'string', description: 'Precise, self-contained instruction for the delegate.' },
        context: {
          type: 'string',
          description: 'Optional extra context (facts/constraints the delegate needs, since it cannot see this chat).',
        },
      },
      required: ['role', 'task'],
    },
    async run(args, ctx) {
      const { role: targetId, task, context } = args as { role: string; task: string; context?: string };
      const depth = ctx.delegationDepth ?? 0;

      if (depth >= MAX_DELEGATION_DEPTH) {
        return `[delegate] Refused: delegation depth limit (${MAX_DELEGATION_DEPTH}) reached. Handle this part yourself instead of delegating further.`;
      }
      if (targetId === ctx.roleId) {
        return `[delegate] Refused: a role cannot delegate to itself ("${targetId}"). Do it yourself or pick another member.`;
      }

      const target = await getRole(targetId);
      // getRole falls back to the default role for unknown ids — reject typos so
      // work isn't silently handed to the wrong member.
      if (target.id !== targetId) {
        return `[delegate] Unknown role "${targetId}". Pick a valid role id from the company roster.`;
      }

      const taskId = randomUUID();
      const base = { sessionKey: ctx.sessionKey, channel: ctx.channel, roleId: ctx.roleId };

      bus.emitEvent({
        type: 'delegate:start',
        taskId,
        toRoleId: target.id,
        toRoleName: target.name,
        task,
        ts: Date.now(),
        ...base,
      });

      const prompt = context ? `${context}\n\n---\n\n${task}` : task;
      // Distinct sub-session so the delegate's history stays isolated from the
      // caller's (and re-delegating to the same member keeps continuity).
      const subKey = `${ctx.sessionKey}::${target.id}`;
      const result = await runTurn(registry, {
        sessionKey: subKey,
        text: prompt,
        roleId: target.id,
        depth: depth + 1,
        channelName: ctx.channel,
      });

      const isError = result.startsWith('[agent error]') || result.startsWith('[budget]');
      bus.emitEvent({ type: 'delegate:end', taskId, toRoleId: target.id, result, isError, ts: Date.now(), ...base });

      return `[delegated to ${target.name} (${target.id})]\n\n${result}`;
    },
  };
}
