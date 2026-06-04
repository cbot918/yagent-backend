import OpenAI from 'openai';
import { complete } from './llm.js';
import { loadSession, saveSession, withSessionLock } from './session.js';
import { getMemoryContext } from './memory/memory.js';
import { loadSkillSummaries } from './skills/loader.js';
import { config } from './config.js';
import { bus } from './events.js';
import type { ToolRegistry, ToolContext } from './tools/types.js';
import type { Channel } from './channels/types.js';

const MAX_ITERATIONS = 20;

type Message = OpenAI.Chat.ChatCompletionMessageParam;

async function buildSystemPrompt(sessionKey: string): Promise<string> {
  const memory = await getMemoryContext(sessionKey);
  const skills = await loadSkillSummaries();
  const skillList =
    skills.length > 0
      ? skills.map((s) => `- **${s.name}** (dir: \`${s.dir}\`): ${s.description}`).join('\n')
      : 'No skills installed.';

  return `You are yagent — a mini AI agent (an OpenClaw demo for COSCUP 2026).

## Your Memory
${memory}

## Available Skills
${skillList}
Call the \`load_skill\` tool to read a skill's full guidance before using it.

## Workspace
${config.workspaceDir}
All file operations must stay within the workspace directory.

Think step by step. Use tools to act, observe results, then continue or respond.`;
}

export function createAgent(registry: ToolRegistry, channel: Channel) {
  async function handle(sessionKey: string, text: string) {
    await withSessionLock(sessionKey, async () => {
      const history = (await loadSession(sessionKey)) as Message[];
      const systemPrompt = await buildSystemPrompt(sessionKey);

      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: text },
      ];

      const tools = registry.toOpenAIFormat();
      const ctx: ToolContext = { sessionKey, workspaceDir: config.workspaceDir };
      let iteration = 0;
      let finalText = '';

      const meta = { sessionKey, channel: channel.name };
      console.log(`\n[loop] session=${sessionKey}`);
      bus.emitEvent({ type: 'turn:start', text, ts: Date.now(), ...meta });

      while (iteration < MAX_ITERATIONS) {
        const response = await complete(messages, tools);
        const msg = response.choices[0].message;
        messages.push(msg as Message);

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
      bus.emitEvent({ type: 'turn:end', finalText, iterations: iteration + 1, ts: Date.now(), ...meta });
      await channel.sendReply(sessionKey, finalText);
    });
  }

  return { handle };
}
