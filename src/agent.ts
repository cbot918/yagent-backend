import OpenAI from 'openai';
import { complete } from './llm.js';
import { loadSession, saveSession, withSessionLock } from './session.js';
import { getMemoryContext } from './memory/memory.js';
import { loadSkillSummaries } from './skills/loader.js';
import { readIndex } from './knowledge/loader.js';
import { getRole, loadRoles, resolvePersona } from './roles/loader.js';
import type { Role } from './roles/types.js';
import { budgetGate, recordUsage, loadBilling, computeLlmCost } from './usage/index.js';
import { config } from './config.js';
import { bus } from './events.js';
import type { ToolRegistry, ToolContext } from './tools/types.js';
import type { Channel } from './channels/types.js';

const MAX_ITERATIONS = 20;

// In 'advise' (advisory-only) mode a role may use only these non-mutating tools.
// Everything else (write_file/shell/browse/dispatch_coding_task/save_memory/…)
// is withheld so the role can read + recommend but not act.
// threads_trend / threads_hot are read-only research (fetch public data, mutate nothing),
// so they stay available in advise mode — though they do spend a metered daily quota.
const READONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'search_knowledge',
  'read_doc',
  'load_skill',
  'threads_trend',
  'threads_hot',
]);

type Message = OpenAI.Chat.ChatCompletionMessageParam;

async function buildSystemPrompt(sessionKey: string, role: Role, mode: 'act' | 'advise'): Promise<string> {
  const memory = await getMemoryContext(sessionKey);

  // Skills: scope to the role's own skills if set, else list all installed.
  const allSkills = await loadSkillSummaries();
  const skills =
    role.skills && role.skills.length ? allSkills.filter((s) => role.skills!.includes(s.dir)) : allSkills;
  const skillList =
    skills.length > 0
      ? skills.map((s) => `- **${s.name}** (dir: \`${s.dir}\`): ${s.description}`).join('\n')
      : 'No skills installed.';

  // Knowledge: always-on INDEX map + this role's bound reference docs.
  const index = await readIndex();
  const roleDocs =
    role.knowledge && role.knowledge.length
      ? role.knowledge.map((d) => `- \`${d}\``).join('\n')
      : '';

  // Company roster: every member except this role (self-delegation is barred).
  // Without this the model has no way to know its colleagues' role ids, so it
  // can never use delegate_to_role (the ids aren't guessable).
  const colleagues = (await loadRoles()).filter((r) => r.id !== role.id);
  const rosterList = colleagues
    .map((r) => `- \`${r.id}\` — ${r.emoji ?? '🤖'} ${r.name}${r.title ? `（${r.title}）` : ''}: ${r.description}`)
    .join('\n');

  const persona = await resolvePersona(role);
  const harness = role.codingAgent ?? config.codingAgent;

  return `${persona}

You are "${role.name}"${role.title ? ` — ${role.title}` : ''}, a member of an agent-os virtual company (an OpenClaw-style demo).

## Your Memory
${memory}

## Available Skills
${skillList}
Call the \`load_skill\` tool to read a skill's full guidance before using it.

## Knowledge base
The company knowledge base lives under \`knowledge/\`. Use \`search_knowledge\` to find relevant docs and \`read_doc\` to read one in full. Ground answers in these docs rather than guessing about ElementAI.
${roleDocs ? `\nYour reference docs (read them when relevant):\n${roleDocs}\n` : ''}${index ? `\nKnowledge map (INDEX):\n${index}` : ''}

## Virtual company roster（你的同事）
${rosterList || '(no other members)'}

要把子任務交給別的成員、或使用者要你「找某人討論/請某人處理」時，呼叫 \`delegate_to_role\`（\`role\` 參數用上面的 id）。對方**看不到這段對話**，\`task\`/\`context\` 必須自包含（把必要的背景、限制、要交付什麼寫清楚）。對方會以自己的 persona/工具/權限跑完並回覆你；把結果整合進你的回答。

## Delegating heavy coding
For multi-file edits or building/running code, call \`dispatch_coding_task\` to delegate to an external coding agent (currently: ${harness}). Provide a precise, self-contained spec; you'll get back the diff/summary to review.

## Workspace
${config.workspaceDir}
All file operations must stay within the workspace directory.
${
  mode === 'advise'
    ? '\n## Mode: ADVISORY (read-only)\nYou are in advisory mode. You can read files, search the knowledge base, and load skills, but you must NOT take actions — no writing files, running shell, browsing, or delegating coding. Analyse and recommend concrete next steps instead; if an action is needed, say exactly what to run and who should do it.\n'
    : ''
}
Think step by step. Use tools to act, observe results, then continue or respond.`;
}

/** Max delegation nesting (a delegate may re-delegate, but not forever). */
export const MAX_DELEGATION_DEPTH = 2;

export interface RunTurnOptions {
  sessionKey: string;
  text: string;
  roleId?: string;
  actionMode?: 'act' | 'advise';
  /** Delegation nesting depth (0 = top-level user turn). */
  depth?: number;
  /** Channel name for event/usage attribution. Defaults to 'agent'. */
  channelName?: string;
}

/**
 * Runs one full role-aware turn — build system prompt → ≤20-iteration
 * tool-calling loop → persist history — and returns the final text. No channel
 * side-effects (the caller decides what to do with the reply). Shared by:
 *  - `handle` (the user-facing turn, which then calls channel.sendReply), and
 *  - the `delegate_to_role` tool (a role handing a subtask to another role,
 *    which just needs the returned text — see src/tools/delegateRole.ts).
 */
export async function runTurn(registry: ToolRegistry, opts: RunTurnOptions): Promise<string> {
  const { sessionKey, text, roleId, actionMode, depth = 0 } = opts;
  const channelName = opts.channelName ?? 'agent';
  let finalText = '';

  await withSessionLock(sessionKey, async () => {
    const role = await getRole(roleId);
    // Effective mode: per-turn override (like plan/edit mode) wins over the
    // role's default; default is 'act'.
    const mode: 'act' | 'advise' = actionMode ?? role.actionMode ?? 'act';
    const history = (await loadSession(sessionKey)) as Message[];
    const systemPrompt = await buildSystemPrompt(sessionKey, role, mode);

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text },
    ];

    // A role may restrict which tools it can use (undefined/empty = all);
    // advisory mode further restricts to read-only tools.
    const allTools = registry.toOpenAIFormat();
    let tools =
      role.tools && role.tools.length
        ? allTools.filter((t) => role.tools!.includes(t.function.name))
        : allTools;
    if (mode === 'advise') tools = tools.filter((t) => READONLY_TOOLS.has(t.function.name));
    const model = role.model || config.model;
    // Attribute orchestrator spend to a provider/key for budgeting.
    const provider = config.openaiBaseUrl.includes('openrouter') ? 'openrouter' : 'openai';
    const keyId = provider;
    const { pricing } = await loadBilling();
    const ctx: ToolContext = {
      sessionKey,
      workspaceDir: config.workspaceDir,
      channel: channelName,
      roleId: role.id,
      codingAgent: role.codingAgent,
      threadsSource: role.threadsSource,
      delegationDepth: depth,
    };
    let iteration = 0;

    const meta = { sessionKey, channel: channelName, roleId: role.id };
    console.log(`\n[loop] session=${sessionKey} role=${role.id}${depth ? ` depth=${depth}` : ''}`);
    bus.emitEvent({ type: 'turn:start', text, ts: Date.now(), ...meta });

    try {
      // Budget enforcement: if a governing cap is already exceeded, pause
      // this role's turn before spending anything.
      const blocked = await budgetGate({ provider, keyId, roleId: role.id });
      if (blocked.length > 0) {
        const b = blocked[0];
        finalText = `[budget] Over the ${b.budget.scope}${b.budget.match ? ` "${b.budget.match}"` : ''} limit: $${b.usedUSD.toFixed(2)} / $${b.limitUSD.toFixed(2)} (last ${b.budget.periodDays}d). Pausing — raise the limit in billing.json to continue.`;
        bus.emitEvent({
          type: 'budget:alert',
          budgetId: b.budget.id,
          scope: b.budget.scope,
          match: b.budget.match,
          usedUSD: b.usedUSD,
          limitUSD: b.limitUSD,
          ts: Date.now(),
          ...meta,
        });
      } else {
        while (iteration < MAX_ITERATIONS) {
          const response = await complete(messages, tools, model);
          const msg = response.choices[0].message;
          messages.push(msg as Message);

          // Meter the orchestrator LLM call.
          if (response.usage) {
            await recordUsage(
              {
                ts: Date.now(),
                sessionKey,
                roleId: role.id,
                source: 'llm',
                provider,
                keyId,
                model,
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
                costUSD: computeLlmCost(pricing, model, response.usage.prompt_tokens, response.usage.completion_tokens),
              },
              { channel: channelName },
            );
          }

          const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          }));

          bus.emitEvent({
            type: 'llm:response',
            iteration: iteration + 1,
            content: msg.content ?? undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            ts: Date.now(),
            ...meta,
          });

          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            finalText = msg.content ?? '';
            console.log(`[loop:${iteration + 1}] llm → final text`);
            break;
          }

          const names = msg.tool_calls.map((tc) => tc.function.name).join(', ');
          console.log(`[loop:${iteration + 1}] llm → tool_calls: [${names}]`);

          for (const tc of msg.tool_calls) {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            bus.emitEvent({ type: 'tool:call', iteration: iteration + 1, name: tc.function.name, args, ts: Date.now(), ...meta });
            const result = await registry.run(tc.function.name, args, ctx);
            console.log(`[loop:${iteration + 1}] tool: ${tc.function.name} → ${result.slice(0, 100)}`);
            bus.emitEvent({ type: 'tool:result', iteration: iteration + 1, name: tc.function.name, result, ts: Date.now(), ...meta });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          }

          iteration++;
        }

        if (!finalText) {
          finalText = '[agent: reached max iterations without a final response]';
        }

        const historyToSave = messages.slice(1); // drop system prompt
        await saveSession(sessionKey, historyToSave);
      }
    } catch (err) {
      // Never let a failed turn (bad API key, network, tool crash) take down the
      // gateway. Surface the error as the reply so the UI unsticks and shows why.
      finalText = `[agent error] ${err instanceof Error ? err.message : String(err)}`;
      console.error('[loop] error:', err);
    }

    bus.emitEvent({ type: 'turn:end', finalText, iterations: iteration + 1, ts: Date.now(), ...meta });
  });

  return finalText;
}

export function createAgent(registry: ToolRegistry, channel: Channel) {
  async function handle(sessionKey: string, text: string, roleId?: string, actionMode?: 'act' | 'advise') {
    const finalText = await runTurn(registry, { sessionKey, text, roleId, actionMode, channelName: channel.name });
    await channel.sendReply(sessionKey, finalText);
  }

  return { handle };
}
