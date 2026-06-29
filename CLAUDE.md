# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`yagent` is a minimal TypeScript re-implementation of OpenClaw's core agent architecture, built as a demo for a COSCUP 2026 talk. Every module deliberately maps 1:1 to a concept from the talk (Gateway, Agent Loop, Tools, Memory, Skills, Plugins, Channels), so keep modules small, single-purpose, and readable as teaching material — clarity over cleverness.

## Commands

```bash
npm install
npm run dev:cli   # CLI REPL — no Discord/token plumbing, the fastest dev loop
npm run dev       # tsx watch on src/index.ts; starts Discord if DISCORD_TOKEN is set
npm run dev:web   # tsx watch + --web flag: starts the REST/WS API on WEB_PORT (no Vite)
npm run dev:all   # backend (dev:web) + Vite dev server for web/, concurrently
npm run build     # tsc → dist/
npm start         # node dist/index.js --web (run build first)

# Vue web UI (in web/)
npm --prefix web run dev    # Vite dev server (proxies API to the backend)
npm run web:build            # builds web/ into web/dist, served by the backend in prod
```

There is **no test runner, linter, or formatter** configured (root or `web/`). "Run tests" means exercising the agent manually via `npm run dev:cli` or the web UI. `npm run build` (tsc with `strict: true`) is the only automated check — use it to catch type errors. `npm --prefix web run build` runs `vue-tsc` and is the equivalent check for the frontend.

Channel selection (`src/index.ts`): CLI starts if `--cli` is passed, or there's no `DISCORD_TOKEN` and stdin is a real TTY (so headless deploys don't block on a `you:` prompt). Discord starts whenever `DISCORD_TOKEN` is set. The web channel starts if `ENABLE_WEB=true` or `--web` is passed. All can run at once — each is just another `Channel` pushed onto the same `channels[]` array and wired to the same agent.

## Module conventions

- **ESM + NodeNext.** All relative imports must use the `.js` extension even though the source is `.ts` (e.g. `import { config } from './config.js'`). This is required by `module: node16` — omitting it breaks the build.
- **Config is centralized** in `src/config.ts` (env via `dotenv`). Read config from there; don't touch `process.env` elsewhere.
- **The LLM is OpenAI-only by design** (`src/llm.ts` is the single swap point). `OPENAI_BASE_URL` lets you point at any OpenAI-compatible endpoint (e.g. OpenRouter). Messages and tools use the raw `openai` SDK types throughout. Voice transcription (`src/voice.ts`) is a *separate* OpenAI client/config (`VOICE_API_*`), because `OPENAI_BASE_URL` may point at a chat-only provider that doesn't serve `/audio/transcriptions`.

## Architecture: the agent loop

`createAgent(registry, channel)` in `src/agent.ts` is the heart of the system. Per incoming message it:

1. Acquires a per-session lock (`withSessionLock`), so concurrent turns for the same session serialize.
2. Builds a fresh system prompt each turn (`buildSystemPrompt`) = persona + current memory + skill name/description list + workspace path.
3. Assembles `[system, ...history, user]` and runs a tool-calling loop (max 20 iterations): call LLM → if `tool_calls`, run each via `ToolRegistry.run` and append `role: 'tool'` results → repeat; otherwise the text reply ends the loop.
4. Persists history (minus the system prompt) and calls `channel.sendReply`.
5. Throughout, emits structured `AgentEvent`s (`turn:start`, `llm:response`, `tool:call`, `tool:result`, `turn:end`) on the global `bus` (`src/events.ts`). The web channel fans these out over WebSocket so the UI can render the workflow live; the CLI/Discord channels ignore the bus and rely on `sendReply`.

Key implication: the system prompt is regenerated every turn, so updated memory/skills take effect immediately. History is replayed in full each turn (no summarization/truncation beyond the 20-iteration cap). A failed turn (bad API key, network, tool crash) is caught in `agent.ts` and surfaced as `[agent error] ...` text rather than crashing the gateway/channel.

## State & persistence (files-as-truth)

All runtime state lives under `WORKSPACE_DIR` (default `./workspace`, gitignored):

- **Sessions**: `.sessions/{sessionKey}.json` — full message history (`src/session.ts`).
- **Memory**: `.memory/{sessionKey}.md` — markdown the agent overwrites via the `save_memory` tool; injected into the system prompt each turn (`src/memory/memory.ts`).

`sessionKey` is the isolation boundary: `cli` for the CLI channel, `{channelId}-{authorId}` for Discord, and a UI-generated key for the web/mobile clients (so each user-in-a-channel/DM/session is separate). Both `session.ts` and `memory.ts` sanitize the key (`[^a-zA-Z0-9_-]` → `_`) before using it as a filename.

## Extension points

- **Tools** (`src/tools/`): implement the `Tool` interface (`name`, `description`, JSON-schema `parameters`, `run(args, ctx)` returning a string). `ToolRegistry.run` catches throws and returns them as `Error: ...` strings — tools surface failures via return value, they don't crash the loop. Register built-ins in `src/index.ts`. File-writing tools must keep paths inside `ctx.workspaceDir` (see the `fullPath.startsWith` guard in `writeFile.ts`).
  - `shell` is gated behind `ALLOW_SHELL=true` and dispatches to a pluggable `Executor` (`src/sandbox/`, selected by `SHELL_BACKEND=host|docker|e2b`). Sandboxes are keyed by `sessionKey` and reused across commands so `cd`/installed packages/files persist within a chat. `host` runs unsandboxed (dev only); `docker` and `e2b` provide real isolation. `getExecutor()` is a singleton with shutdown cleanup (`disposeAll`) on `SIGINT`/`SIGTERM`/`beforeExit`.
  - `browse` is gated behind `ALLOW_BROWSER=true` and uses a shared headless Playwright Chromium (`src/browser/manager.ts`, lazy singleton, same shutdown-cleanup pattern as the sandbox). It has a built-in SSRF guard (`checkUrl` in `browse.ts`) blocking localhost/private-IP/cloud-metadata hosts.
- **Skills** (prompt-based, `skills/<dir>/SKILL.md`): the loader parses **line 1 as the name and line 2 as the description** (after stripping leading `#`). All skills' name+description are listed in the system prompt; the full body is loaded on demand via the `load_skill` tool. Adding a skill is pure file creation — no code change.
- **Plugins** (code-based, `plugins/<dir>/index.ts`): `export default { name, init(ctx) }`. `init` receives a `PluginContext` to `registerTool`/`registerChannel`. Loaded at startup by `src/plugins/loader.ts`; failures are swallowed so one bad plugin can't take down the gateway.

## Channels

A `Channel` (`src/channels/types.ts`) has `name`, `start(onMessage)`, and `sendReply(sessionKey, text)`. `start` wires the channel's events to the agent handler.

- `discord.ts`: tracks the originating `Message` per session to thread replies, chunks output to Discord's ~2000-char limit, and shows a typing indicator while the loop runs.
- `cli.ts`: terminal REPL adapter.
- `web.ts`: serves a small REST API (`/api/sessions`, `/api/sessions/:key`, `/api/sessions/:key/memory`, `/api/transcribe`) plus a `/ws` WebSocket that broadcasts every `AgentEvent` from `bus` to connected browsers. `sendReply` is a no-op here — the UI renders replies from the `turn:end` event instead. In prod it also serves the built `web/dist` (with SPA fallback to `index.html`); `WEB_ORIGIN` controls CORS for a separately-deployed frontend.

## Web UI (`web/`)

A separate Vue 3 + Vite + Pinia app (own `package.json`, not part of the root TS project/build). `web/src/stores/agent.ts` holds the `apply()` reducer that turns the `AgentEvent` stream into a per-session view model (turns → iterations → tool calls/results); `composables/useAgentSocket.ts` owns the WebSocket connection + auto-reconnect, `composables/useSpeech.ts` wraps the Web Speech API with a server-transcription (`/api/transcribe`) fallback. Build output (`web/dist`) is what `web.ts` serves in production.

## Mobile client (`mobile/`)

A Flutter Android client that speaks the same WS/REST protocol as the web UI — no backend changes needed. `lib/store.dart`'s `apply()` reducer is a verbatim port of `web/src/stores/agent.ts`; `lib/models.dart` mirrors `web/src/types.ts`. See `mobile/mobile_dev.md` for toolchain setup and gotchas. Treat this as a thin, protocol-compatible client — protocol changes to the `AgentEvent` stream or REST API must be mirrored in both `web/src/stores/agent.ts` and `mobile/lib/store.dart`.

> ⚠️ The mobile client has NOT yet been updated for the agent-os additions below (new `dispatch:*` / `cost:*` / `budget:*` events, `roleId`, role/usage endpoints). Mirror those into `mobile/` when the mobile client is next touched.

## agent-os layer (built on top of yagent)

This repo doubles as **agent-os**: a trigger/orchestration layer that wraps a *swappable coding harness* and runs a *virtual company* of role-personas, with cost/budget metering. Built in-place on yagent (not a separate copy). Three additive subsystems:

1. **Swappable coding agent** (`src/coding-agent/`) — mirrors the `sandbox/Executor` pattern: one `CodingAgent` interface, backends selected by `CODING_AGENT` env via `getCodingAgent()`.
   - `claude.ts` spawns `claude -p --output-format stream-json` and parses the NDJSON (`assistant` content → events; final `result` → summary/`total_cost_usd`/`usage`). `opencode.ts` spawns `opencode run -m <provider/model>` (point at OpenRouter via `OPENCODE_MODEL` + `OPENROUTER_API_KEY`).
   - The orchestrator delegates via the `dispatch_coding_task` tool (`src/tools/dispatchCoding.ts`): blocks, returns the final diff/summary string to the loop (Tool interface unchanged), and streams progress to the bus as `dispatch:*` events.
   - ⚠️ Claude billing: rides your `claude` OAuth login (subscription) **only if `ANTHROPIC_API_KEY` is unset** — otherwise it silently bills metered API. `CLAUDE_YOLO=true` adds `--dangerously-skip-permissions` for headless autonomy (self-use).

2. **Roles = virtual-company members** (`src/roles/`, data in `roles/roles.json`) — manual switchboard: the user picks a member to talk to. A role = persona (inline `systemPrompt` or referenced `skill`) + optional `model` + `codingAgent` + tool allowlist. The agent loop is now role-aware: `handle(sessionKey, text, roleId?)` resolves the role, builds its persona into the system prompt, picks its model, filters tools, and sets `ctx.roleId`/`ctx.codingAgent`. Adding a member = editing JSON (no code change).

3. **Cost/budget metering** (`src/usage/`, config in `billing.json`) — every orchestrator LLM call and every dispatch appends a `UsageEntry` to `.usage/ledger.jsonl` (files-as-truth). `billing.json` holds keys/subscriptions, budgets (scope: global/provider/key/role), and a token price table. Enforcement: `budgetGate()` runs before each turn and before each dispatch and blocks if a governing budget is exceeded; `recordUsage()` appends + emits `cost:update`/`budget:alert`.

**New AgentEvents** (`src/events.ts`, also carry optional `roleId`): `dispatch:start|event|end`, `cost:update`, `budget:alert`. **New REST**: `/api/roles`, `/api/usage`. These must stay mirrored in `web/src/types.ts` + `web/src/stores/agent.ts` (and eventually `mobile/`).

**Web dashboard** (`web/`): a grid landing view (`components/Dashboard.vue`) with member cards (click → role-bound chat), workflow cards (node-graph designer — **deferred placeholder**), and a budget panel. `store.view` toggles dashboard ↔ session; `openRole()` creates a `web-<roleId>-<rand>` session; `DispatchCard.vue` renders delegated-coding progress inside the timeline.

**Deferred (recorded, not built):** the workflow node-graph designer (the workflow cards). See `../agent-os/HANDOFF.md` for the original design note.
