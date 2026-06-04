# yagent — A Mini Agentic System

> Demo repo for COSCUP 2026 talk: **"Agentic System: a case study of OpenClaw"**  
> Section 5 — *Write your own mini agentic system*

`yagent` is a minimal TypeScript re-implementation of OpenClaw's core architecture.
Each module maps directly to a concept from the talk.

## Concept → Module Map

| OpenClaw Concept              | yagent module                   | What it does                                      |
|-------------------------------|---------------------------------|---------------------------------------------------|
| **Gateway** (multi-channel)   | `src/index.ts`                  | Wires channels + plugins, starts the gateway      |
| **Agent Loop**                | `src/agent.ts`                  | LLM → tool call → observe → repeat               |
| **LLM client**                | `src/llm.ts`                    | OpenAI wrapper (one file = one swap point)        |
| **Tool Use**                  | `src/tools/`                    | Tool interface + registry + built-in tools        |
| **Memory** (files-as-truth)   | `src/memory/memory.ts`          | Reads/writes `.memory/{session}.md`               |
| **Skills** (prompt-based)     | `src/skills/loader.ts`          | Injects `skills/*/SKILL.md` into context          |
| **Plugins** (code-based)      | `src/plugins/`                  | Loads `plugins/*/index.ts`, registers tools       |
| **Session state**             | `src/session.ts`                | Persists history + serializes concurrent turns    |
| **Channel** (Discord)         | `src/channels/discord.ts`       | Discord adapter implementing `Channel` interface  |
| **Channel** (CLI/dev)         | `src/channels/cli.ts`           | Terminal REPL for testing without Discord         |

## The Agent Loop

```
User message
     │
     ▼
[1] Assemble context
     system prompt + memory + skill summaries + history + user msg
     │
     ▼
[2] LLM call (OpenAI)
     │
     ├── tool_calls? ──► [3] Execute tools via ToolRegistry
     │                         │
     │                         └── observe result → append → goto [2]
     │
     └── text response ──► [4] sendReply via Channel
                                 persist session + memory
```

## Quickstart

```bash
cp .env.example .env
# fill in OPENAI_API_KEY (and DISCORD_TOKEN if using Discord)

npm install

# CLI mode (no Discord needed — great for testing)
npm run dev:cli

# Discord mode
npm run dev
```

### Discord bot setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → give it a name (e.g. "yagent").
2. Left sidebar → **Bot** → scroll to **Privileged Gateway Intents** → enable **MESSAGE CONTENT INTENT** (required to read message text in servers).
3. Still on the **Bot** tab → **Reset Token** → copy it → add to `.env`:
   ```
   DISCORD_TOKEN=your-token-here
   ```
4. Left sidebar → **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `View Channels`, `Send Messages`, `Read Message History`
   - Copy the generated URL, open it in a browser, and authorize the bot into your server.
5. `npm run dev` — with `DISCORD_TOKEN` set, the Discord channel starts automatically.

**DMs:** The bot also supports direct messages. You must share a server with it first (Discord requirement). DMs are separate sessions from server messages.

### Environment variables

| Variable        | Default         | Description                            |
|-----------------|-----------------|----------------------------------------|
| OPENAI_API_KEY  | (required)      | Your OpenAI API key                    |
| OPENAI_MODEL    | `gpt-4o-mini`   | Model name                             |
| DISCORD_TOKEN   | (optional)      | Discord bot token; omit for CLI mode   |
| WORKSPACE_DIR   | `./workspace`   | Directory for all agent file ops       |
| ALLOW_SHELL     | `false`         | Set `true` to enable the `shell` tool  |

## Built-in Tools

| Tool           | Description                                      |
|----------------|--------------------------------------------------|
| `read_file`    | Read a file in the workspace                     |
| `write_file`   | Write / create a file in the workspace           |
| `list_files`   | List workspace contents                          |
| `save_memory`  | Persist markdown memory (survives restarts)      |
| `load_skill`   | Load a skill's full SKILL.md guidance            |
| `shell`        | Run a shell command (requires ALLOW_SHELL=true)  |

## Extension points

### Skills (prompt-based)
Create a folder under `skills/` with a `SKILL.md`:
```
skills/
  my-skill/
    SKILL.md      ← name on line 1, description on line 2, then instructions
```
The agent sees all skill names + descriptions in its system prompt and can call `load_skill` to read the full body.

### Plugins (code-based)
Create a folder under `plugins/` with an `index.ts`:
```typescript
// plugins/my-plugin/index.ts
export default {
  name: 'my-plugin',
  init(ctx) {
    ctx.registerTool({
      name: 'my_tool',
      description: '...',
      parameters: { type: 'object', properties: { ... }, required: [...] },
      async run(args) { return 'result'; },
    });
    // ctx.registerChannel(myChannel);  // you can also add channels
  },
};
```

## Project structure

```
yagent/
  src/
    index.ts          ← entrypoint / gateway
    config.ts         ← env + defaults
    llm.ts            ← OpenAI wrapper
    agent.ts          ← THE agent loop
    session.ts        ← per-session history + write-lock
    tools/
      types.ts        ← Tool interface + ToolRegistry
      readFile.ts  writeFile.ts  listFiles.ts  shell.ts
    memory/
      memory.ts       ← file-based memory (files-as-truth)
    skills/
      loader.ts       ← scan + inject SKILL.md files
    plugins/
      types.ts        ← Plugin + PluginContext interfaces
      loader.ts       ← discover + init plugins
    channels/
      types.ts        ← Channel interface
      discord.ts      ← Discord adapter
      cli.ts          ← terminal REPL adapter
  skills/
    note-taking/SKILL.md
  plugins/
    hello-plugin/index.ts
  workspace/          ← agent's working directory (gitignored runtime data)
```
