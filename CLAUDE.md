# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`yagent` is a minimal TypeScript re-implementation of OpenClaw's core agent architecture, built as a demo for a COSCUP 2026 talk. Every module deliberately maps 1:1 to a concept from the talk (Gateway, Agent Loop, Tools, Memory, Skills, Plugins, Channels), so keep modules small, single-purpose, and readable as teaching material — clarity over cleverness.

## Commands

```bash
npm install
npm run dev:cli   # CLI REPL — no Discord/token plumbing, the fastest dev loop
npm run dev       # tsx watch on src/index.ts; starts Discord if DISCORD_TOKEN is set
npm run dev:web   # tsx watch + --web flag: starts the REST/WS API on WEB_PORT (no web dev server)
npm run dev:all   # backend (dev:web) + Next.js dev server for web/, concurrently
npm run build     # tsc → dist/
npm start         # node dist/index.js --web (run build first)

# Next.js web UI (in web/)
npm --prefix web run dev    # Next dev server on :3000 (talks to backend via NEXT_PUBLIC_API_BASE)
npm run web:build            # next build (static export) → web/dist, served by the backend in prod
```

There is **no test runner, linter, or formatter** configured (root or `web/`). "Run tests" means exercising the agent manually via `npm run dev:cli` or the web UI. `npm run build` (tsc with `strict: true`) is the only automated check — use it to catch type errors. `npm --prefix web run build` runs `next build` (type-checks + statically exports to `web/dist`) and is the equivalent check for the frontend.

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
  - `threads_trend` searches public Threads (Meta) posts for a keyword to research trends. The tool is thin; the actual fetching is a **swappable `ThreadsSource`** (`src/threads/`, see the agent-os subsystem below). Registered when *either* source is available (`ENSEMBLEDATA_TOKEN` set **or** `ALLOW_BROWSER=true`). Every call is written to the Monitor log (`src/monitor/threadsLog.ts`).
  - `threads_hot` is topic *discovery* (vs `threads_trend`'s single-keyword drill-down): Threads has no trending API, so it fans out searches over a seed keyword pool (`roles/seeds.json`, `seeds` arg overrides, read fresh per call) and mines rising terms in code (`src/threads/mine.ts`: hashtags + CJK 2–6-char n-grams + latin tokens; copypasta near-dup collapse, stopword/boundary-char/numeral-measure filters, seed-spread + 14-day freshness gates, df×log-engagement×recency×length/hashtag scoring, post-set-diversity selection so one template family takes one slot). Same registration condition + Monitor logging as `threads_trend` (one line per seed, keyword `hot:<seed>`). On the metered backend a fan-out costs 1 unit per seed, so when browser fallback is allowed the whole scan routes to `browser`. Used by `trend-analyst` with the `trend-hunting` skill (discover → drill down → ranked keyword report with app-opportunity angles).- **Skills** (prompt-based, `skills/<dir>/SKILL.md`): the loader parses **line 1 as the name and line 2 as the description** (after stripping leading `#`). Each role sees its own skills (`role.skills`) — or all if unset — listed in the system prompt; the full body is loaded on demand via the `load_skill` tool. Adding a skill is pure file creation — no code change.
- **Knowledge** (L2 doc library, `knowledge/<area>/*.md`): files-as-truth, on-demand retrieval (no vector store, no fine-tuning). `knowledge/INDEX.md` is injected into every system prompt as an always-on map (progressive disclosure); `search_knowledge` (grep-style) and `read_doc` pull full docs on demand, both path-guarded to `knowledge/` via `resolveInKnowledge` (`src/knowledge/loader.ts`, mirrors `resolveInWorkspace`). A role binds reference docs via `role.knowledge` (paths relative to `knowledge/`), surfaced as "your reference docs". Adding/editing knowledge is pure file creation.
- **Plugins** (code-based, `plugins/<dir>/index.ts`): `export default { name, init(ctx) }`. `init` receives a `PluginContext` to `registerTool`/`registerChannel`. Loaded at startup by `src/plugins/loader.ts`; failures are swallowed so one bad plugin can't take down the gateway.

## Channels

A `Channel` (`src/channels/types.ts`) has `name`, `start(onMessage)`, and `sendReply(sessionKey, text)`. `start` wires the channel's events to the agent handler.

- `discord.ts`: tracks the originating `Message` per session to thread replies, chunks output to Discord's ~2000-char limit, and shows a typing indicator while the loop runs.
- `cli.ts`: terminal REPL adapter.
- `web.ts`: serves a small REST API (`/api/sessions`, `/api/sessions/:key`, `/api/sessions/:key/memory`, `/api/transcribe`) plus a `/ws` WebSocket that broadcasts every `AgentEvent` from `bus` to connected browsers. `sendReply` is a no-op here — the UI renders replies from the `turn:end` event instead. In prod it also serves the built `web/dist` (with SPA fallback to `index.html`); `WEB_ORIGIN` controls CORS for a separately-deployed frontend.

## Web UI (`web/`)

A separate Next.js 15 (App Router) + shadcn/ui + Zustand app (own `package.json`, not part of the root TS project/build; it's also its own embedded git repo). It's a **static export** (`output: 'export'` in `next.config.mjs`) — the whole app is client-only (WebSocket, Web Speech, store view state). `web/lib/store.ts` is the Zustand store (`immer` middleware) holding the `apply()` reducer that turns the `AgentEvent` stream into a per-session view model (turns → iterations → tool calls/results); `lib/useAgentSocket.ts` owns the WebSocket connection + auto-reconnect, `lib/useSpeech.ts` wraps the Web Speech API with a server-transcription (`/api/transcribe`) fallback; `lib/types.ts` mirrors the backend event/REST shapes. `app/page.tsx` is the client entry: a **persistent left sidebar** (`components/Sidebar.tsx`) + a main pane that switches on `store.view` (`welcome` ↔ `session` ↔ `settings`, no client router); components live in `components/*.tsx` with shadcn primitives under `components/ui/`. The backend origin comes from `NEXT_PUBLIC_API_BASE` (inlined at build; `.env.development` → `http://localhost:3001`, `.env.production` → the deployed backend). `npm run build` runs `next build` then renames the export `out/` → `dist/`, so `web.ts` and the Zeabur static deploy keep serving `web/dist` unchanged.

## Mobile client (`mobile/`)

A Flutter Android client that speaks the same WS/REST protocol as the web UI — no backend changes needed. `lib/store.dart`'s `apply()` reducer is a verbatim port of `web/lib/store.ts`; `lib/models.dart` mirrors `web/lib/types.ts`. See `mobile/mobile_dev.md` for toolchain setup and gotchas. Treat this as a thin, protocol-compatible client — protocol changes to the `AgentEvent` stream or REST API must be mirrored in both `web/lib/store.ts` and `mobile/lib/store.dart`.

> ⚠️ The mobile client has NOT yet been updated for the agent-os additions below (new `dispatch:*` / `cost:*` / `budget:*` events, `roleId`, role/usage endpoints, the `threads-sources` / `monitor/threads` endpoints, and the role `threadsSource` field). Mirror those into `mobile/` when the mobile client is next touched.

## agent-os layer (built on top of yagent)

This repo doubles as **agent-os**: a trigger/orchestration layer that wraps a *swappable coding harness* and runs a *virtual company* of role-personas, with cost/budget metering. Built in-place on yagent (not a separate copy). Four additive subsystems:

1. **Swappable coding agent** (`src/coding-agent/`) — mirrors the `sandbox/Executor` pattern: one `CodingAgent` interface, backends selected by `CODING_AGENT` env via `getCodingAgent()`.
   - `claude.ts` spawns `claude -p --output-format stream-json` and parses the NDJSON (`assistant` content → events; final `result` → summary/`total_cost_usd`/`usage`). `opencode.ts` spawns `opencode run -m <provider/model>` (point at OpenRouter via `OPENCODE_MODEL` + `OPENROUTER_API_KEY`).
   - The orchestrator delegates via the `dispatch_coding_task` tool (`src/tools/dispatchCoding.ts`): blocks, returns the final diff/summary string to the loop (Tool interface unchanged), and streams progress to the bus as `dispatch:*` events.
   - ⚠️ Claude billing: rides your `claude` OAuth login (subscription) **only if `ANTHROPIC_API_KEY` is unset** — otherwise it silently bills metered API. `CLAUDE_YOLO=true` adds `--dangerously-skip-permissions` for headless autonomy (self-use).

2. **Roles = virtual-company members** (`src/roles/`, data in `roles/roles.json`) — manual switchboard: the user picks a member to talk to. A role = persona (inline `systemPrompt` or referenced `skill`) + optional `model` + `codingAgent` + tool allowlist (`tools`) + owned skills (`skills`) + bound knowledge docs (`knowledge`) + default `actionMode` (`act`/`advise`). All editable from the web settings page (persona stays file-authored). The agent loop is now role-aware: the core is `runTurn(registry, opts)` (`src/agent.ts`) — resolves the role, builds its persona into the system prompt (with its skills, bound knowledge, and the knowledge INDEX), picks its model, filters tools, sets `ctx.roleId`/`ctx.codingAgent`, runs the loop, and **returns the final text**; `handle(sessionKey, text, roleId?, actionMode?)` is just `runTurn` + `channel.sendReply`. Adding a member = editing JSON (no code change). The 13 seed roles are a Traditional-Chinese (繁中) "virtual company" grounded in `knowledge/company/company-plan.md`.
   - **Inter-role delegation** (`delegate_to_role`, `src/tools/delegateRole.ts`): a role can hand a self-contained subtask to *another* member, which runs a full `runTurn` of its own (its persona/model/tools/action-mode all apply) on a derived sub-session `<caller>::<role>`; the delegate's final reply returns to the caller's loop as the tool result (Tool interface unchanged). Bracketed by `delegate:start`/`delegate:end` bus events (UI: `DelegateCard`). Guards: depth-limited (`MAX_DELEGATION_DEPTH`), no self-delegation, unknown-role rejected; budget/usage enforced+metered inside `runTurn` under the *delegate's* role. The **company roster is injected into every system prompt** (`buildSystemPrompt` lists all other members with their role ids) — without it the model can't know valid delegation targets. This is **single-shot task delegation**, distinct from the still-deferred multi-step workflow node-graph designer.

3. **Cost/budget metering** (`src/usage/`, config in `billing.json`) — every orchestrator LLM call and every dispatch appends a `UsageEntry` to `.usage/ledger.jsonl` (files-as-truth). `billing.json` holds keys/subscriptions, budgets (scope: global/provider/key/role), and a token price table. Enforcement: `budgetGate()` runs before each turn and before each dispatch and blocks if a governing budget is exceeded; `recordUsage()` appends + emits `cost:update`/`budget:alert`.

4. **Swappable Threads source + Monitor** (`src/threads/`, `src/monitor/`) — mirrors the coding-agent registry pattern: one `ThreadsSource` interface, backends selected by `THREADS_SOURCE` env (or per-role `role.threadsSource`, threaded via `ctx.threadsSource`) through `getThreadsSource()`. Backends: `ensembledata.ts` (metered unofficial API — free tier counts *units* not requests; HTTP 495 = daily quota gone) and `browser.ts` (free headless scrape — loads the public Threads search page via `withPage` and pulls Threads' own hydration JSON out of `<script type="application/json">` tags). Both feed the **shared parser** `src/threads/parse.ts` (`extractPosts`/`findUnits`). The `threads_trend` tool resolves the source, and on quota exhaustion **auto-falls back** to `browser` when `THREADS_FALLBACK !== false` and `ALLOW_BROWSER=true`. Every backend attempt is appended to `.monitor/threads.jsonl` (files-as-truth, `src/monitor/threadsLog.ts`) — this is what powers the sidebar **Monitor** panel and the *real* per-day call count (so the model doesn't guess it). Add a source by adding a factory to `src/threads/index.ts` `factories` (`listThreadsSources()` → `/api/threads-sources`).

5. **Room channels** (`src/rooms/`) — multi-role meeting rooms. A room = `{ id, name, participants[], transcript[] }` persisted to `WORKSPACE_DIR/.rooms/<id>.json` (files-as-truth; seed room `main`「會議室」created at startup by `ensureDefaultRoom`). Messages whose sessionKey matches `room:<id>` are routed (in `src/index.ts`) to `runRoomMessage` (`orchestrator.ts`) instead of the agent loop: it appends the user msg, has a **moderator** (one cheap `complete()` call, JSON output, metered) pick the 1–3 most relevant participants (点名 works naturally — the moderator picks the named member), then each picked role speaks once via a full **`runTurn`** on its private sub-session `room:<id>::<roleId>` (own persona/tools/budget; sees the speaker-labelled transcript **delta** since it last spoke, capped at 30 entries). Serialized per room via `withSessionLock`. Guards: moderator parse failure → falls back to the first participant; empty room → system notice.

**New AgentEvents** (`src/events.ts`, also carry optional `roleId`): `dispatch:start|event|end`, `delegate:start|event|end`, `room:message`/`room:round:start|end`, `cost:update`, `budget:alert`. **REST**: read — `/api/roles`, `/api/usage`, `/api/tools`, `/api/agents`, `/api/threads-sources`, `/api/monitor/threads`, `/api/rooms`, `/api/rooms/:id`; write — `POST /api/roles/:id` (persists a role's editable fields via `saveRole`, whose allowlist now includes `threadsSource`), `POST /api/rooms/:id/participants` `{add?|remove?: roleId}`. These must stay mirrored in `web/lib/types.ts` + `web/lib/store.ts` (and eventually `mobile/`).

**Action mode** (per role + per turn): `role.actionMode` (`'act'` default | `'advise'`) and a per-turn override threaded through `handle(...,actionMode?)` and the WS `send` message (like plan/edit mode). In `advise`, the agent loop filters tools to `READONLY_TOOLS` (`agent.ts`) — read-only/advisory, no write/shell/browse/dispatch. **Swappable harness registry**: `src/coding-agent/index.ts` `factories` map — add a backend there to make it selectable per-role (`listCodingAgents()` → `/api/agents`).

**Web shell** (`web/`): a persistent left sidebar (`components/Sidebar.tsx`, desktop static column / mobile `Sheet` drawer; **all sections default collapsed except Virtual company**) with six collapsible sections — the five below plus **Room channels** (→ `components/RoomChannelsView.tsx`: a roles bench you drag members from into the channel drop-zone (click = mobile fallback, ✕ on chips removes), the room transcript rendered as speaker-attributed bubbles from `room:message` events, and a `ChatInput` sending to sessionKey `room:main` over the same WS `send`). Sections — **Sessions** (reuses `SessionList`), **Virtual company** (member rows: click → role-bound chat via `openRole()` which creates a `web-<roleId>-<rand>` session; ⚙ gear → role settings; plus workflow + projects `soon` placeholders — node-graph designer is a **deferred placeholder**), **Budget & spend** (`components/BudgetPanel.tsx`: total + budget bars, expandable keys breakdown), **Monitor** (`components/MonitorView.tsx`: the `threads_trend` call log from `/api/monitor/threads` — per-call source/status/units/preview + today's count), and **Settings**. The main pane switches on `store.view` (`welcome` ↔ `session` ↔ `settings` ↔ `role` ↔ `monitor` ↔ `rooms`); `components/DispatchCard.tsx` renders delegated-coding progress inside the timeline. `components/Settings.tsx` edits each role's model / coding harness / **Threads source** (shown only when the role has `threads_trend`) / action mode / tool allowlist and POSTs to `/api/roles/:id`; `SessionView` has a per-session action-mode toggle.

**Deferred (recorded, not built):** the workflow node-graph designer (the workflow cards). See `../agent-os/HANDOFF.md` for the original design note.
