# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`yagent` is a minimal TypeScript re-implementation of OpenClaw's core agent architecture, built as a demo for a COSCUP 2026 talk. Every module deliberately maps 1:1 to a concept from the talk (Gateway, Agent Loop, Tools, Memory, Skills, Plugins, Channels), so keep modules small, single-purpose, and readable as teaching material — clarity over cleverness.

## Commands

```bash
npm install
npm run dev:cli   # CLI REPL — no Discord/token plumbing, the fastest dev loop
npm run dev       # tsx watch on src/index.ts; starts Discord if DISCORD_TOKEN is set
npm run build     # tsc → dist/
npm start         # node dist/index.js (run build first)
```

There is **no test runner, linter, or formatter** configured. "Run tests" means exercising the agent manually via `npm run dev:cli`. `npm run build` (tsc with `strict: true`) is the only automated check — use it to catch type errors.

Channel selection (`src/index.ts`): CLI starts if there is no `DISCORD_TOKEN` *or* `--cli` is passed; Discord starts whenever a token is present. Both can run at once.

## Module conventions

- **ESM + NodeNext.** All relative imports must use the `.js` extension even though the source is `.ts` (e.g. `import { config } from './config.js'`). This is required by `module: node16` — omitting it breaks the build.
- **Config is centralized** in `src/config.ts` (env via `dotenv`). Read config from there; don't touch `process.env` elsewhere.
- **The LLM is OpenAI-only by design** (`src/llm.ts` is the single swap point). `OPENAI_BASE_URL` lets you point at any OpenAI-compatible endpoint. Messages and tools use the raw `openai` SDK types throughout.

## Architecture: the agent loop

`createAgent(registry, channel)` in `src/agent.ts` is the heart of the system. Per incoming message it:

1. Acquires a per-session lock (`withSessionLock`), so concurrent turns for the same session serialize.
2. Builds a fresh system prompt each turn (`buildSystemPrompt`) = persona + current memory + skill name/description list + workspace path.
3. Assembles `[system, ...history, user]` and runs a tool-calling loop (max 20 iterations): call LLM → if `tool_calls`, run each via `ToolRegistry.run` and append `role: 'tool'` results → repeat; otherwise the text reply ends the loop.
4. Persists history (minus the system prompt) and calls `channel.sendReply`.

Key implication: the system prompt is regenerated every turn, so updated memory/skills take effect immediately. History is replayed in full each turn (no summarization/truncation beyond the 20-iteration cap).

## State & persistence (files-as-truth)

All runtime state lives under `WORKSPACE_DIR` (default `./workspace`, gitignored):

- **Sessions**: `.sessions/{sessionKey}.json` — full message history (`src/session.ts`).
- **Memory**: `.memory/{sessionKey}.md` — markdown the agent overwrites via the `save_memory` tool; injected into the system prompt each turn (`src/memory/memory.ts`).

`sessionKey` is the isolation boundary: `cli` for the CLI channel, `{channelId}-{authorId}` for Discord (so each user-in-a-channel/DM is a separate session). Both `session.ts` and `memory.ts` sanitize the key (`[^a-zA-Z0-9_-]` → `_`) before using it as a filename.

## Extension points

- **Tools** (`src/tools/`): implement the `Tool` interface (`name`, `description`, JSON-schema `parameters`, `run(args, ctx)` returning a string). `ToolRegistry.run` catches throws and returns them as `Error: ...` strings — tools surface failures via return value, they don't crash the loop. Register built-ins in `src/index.ts`. File-writing tools must keep paths inside `ctx.workspaceDir` (see the `fullPath.startsWith` guard in `writeFile.ts`). The `shell` tool is gated behind `ALLOW_SHELL=true`.
- **Skills** (prompt-based, `skills/<dir>/SKILL.md`): the loader parses **line 1 as the name and line 2 as the description** (after stripping leading `#`). All skills' name+description are listed in the system prompt; the full body is loaded on demand via the `load_skill` tool. Adding a skill is pure file creation — no code change.
- **Plugins** (code-based, `plugins/<dir>/index.ts`): `export default { name, init(ctx) }`. `init` receives a `PluginContext` to `registerTool`/`registerChannel`. Loaded at startup by `src/plugins/loader.ts`; failures are swallowed so one bad plugin can't take down the gateway.

## Channels

A `Channel` (`src/channels/types.ts`) has `name`, `start(onMessage)`, and `sendReply(sessionKey, text)`. `start` wires the channel's events to the agent handler. The Discord channel tracks the originating `Message` per session to thread replies, chunks output to Discord's ~2000-char limit, and shows a typing indicator while the loop runs.
