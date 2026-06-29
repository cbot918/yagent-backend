import OpenAI from 'openai';
import { complete } from './llm.js';
import { loadSession, saveSession, withSessionLock } from './session.js';
import { getMemoryContext } from './memory/memory.js';
import { loadSkillSummaries } from './skills/loader.js';
import { getRole, resolvePersona } from './roles/loader.js';
import type { Role } from './roles/types.js';
import { budgetGate, recordUsage, loadBilling, computeLlmCost } from './usage/index.js';
import { config } from './config.js';
import { bus } from './events.js';
import type { ToolRegistry, ToolContext } from './tools/types.js';
import type { Channel } from './channels/types.js';

const MAX_ITERATIONS = 20;

type Message = OpenAI.Chat.ChatCompletionMessageParam;

async function buildSystemPrompt(sessionKey: string, role: Role): Promise<string> {
  const memory = await getMemoryContext(sessionKey);
  const skills = await loadSkillSummaries();
  const skillList =
    skills.length > 0
      ? skills.map((s) => `- **${s.name}** (dir: \`${s.dir}\`): ${s.description}`).join('\n')
      : 'No skills installed.';
  const persona = await resolvePersona(role);
  const harness = role.codingAgent ?? config.codingAgent;

  return `${persona}

You are "${role.name}"${role.title ? ` — ${role.title}` : ''}, a member of an agent-os virtual company (an OpenClaw-style demo).

## Your Memory
${memory}

## Available Skills
${skillList}
Call the \`load_skill\` tool to read a skill's full guidance before using it.

## Delegating heavy coding
For multi-file edits or building/running code, call \`dispatch_coding_task\` to delegate to an external coding agent (currently: ${harness}). Provide a precise, self-contained spec; you'll get back the diff/summary to review.

## Workspace
${config.workspaceDir}
All file operations must stay within the workspace directory.

Think step by step. Use tools to act, observe results, then continue or respond.`;
}

export function createAgent(registry: ToolRegistry, channel: Channel) {
  async function handle(sessionKey: string, text: string, roleId?: string) {
    await withSessionLock(sessionKey, async () => {
      const role = await getRole(roleId);
      const history = (await loadSession(sessionKey)) as Message[];
      const systemPrompt = await buildSystemPrompt(sessionKey, role);

      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: text },
      ];

      // A role may restrict which tools it can use (undefined/empty = all).
      const allTools = registry.toOpenAIFormat();
      const tools =
        role.tools && role.tools.length
          ? allTools.filter((t) => role.tools!.includes(t.function.name))
          : allTools;
      const model = role.model || config.model;
      // Attribute orchestrator spend to a provider/key for budgeting.
      const provider = config.openaiBaseUrl.includes('openrouter') ? 'openrouter' : 'openai';
      const keyId = provider;
      const { pricing } = await loadBilling();
      const ctx: ToolContext = {
        sessionKey,
        workspaceDir: config.workspaceDir,
        channel: channel.name,
        roleId: role.id,
        codingAgent: role.codingAgent,
      };
      let iteration = 0;
      let finalText = '';

      const meta = { sessionKey, channel: channel.name, roleId: role.id };
      console.log(`\n[loop] session=${sessionKey} role=${role.id}`);
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
              { channel: channel.name },
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
      await channel.sendReply(sessionKey, finalText);
    });
  }

  return { handle };
}
