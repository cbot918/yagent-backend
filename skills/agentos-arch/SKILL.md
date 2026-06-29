# AgentOS Architecture & Tasks
快速掌握 AgentOS/yagent 專案：架構速覽、模組地圖、目前任務，並維護根目錄 ARCHITECTURE.md（架構 + 任務總列表）。

## 何時用
- 開新 session、要快速掌握專案現況/架構/任務時。
- 完成一個任務、或動到架構（新模組/工具/通道/欄位）後，要更新進度時。

## 專案一句話
`yagent`（OpenClaw 極簡重寫）上就地疊的 **agent-os**：編排層 + 可抽換 coding harness + 13 角色虛擬公司（手動切換）+ 費用/預算計量。純自用、商業級、繁中優先。

## 架構速覽（模組 → 檔案）
- **Agent loop（核心）** `src/agent.ts`：role-aware，每回合重建 system prompt（persona + memory + 角色技能 + 綁定知識 + 知識 INDEX）→ ≤20 次 tool-calling 迴圈 → 存 history → sendReply；發 `bus` 事件、budgetGate/recordUsage 接點。
- **LLM** `src/llm.ts`（OpenAI-only，`complete(messages,tools,model)`）。**Config** 集中 `src/config.ts`。
- **Tools** `src/tools/`：`Tool` 介面，registry catch 例外回字串。readFile/writeFile（workspace path guard）/listFiles/knowledge/dispatchCoding/shell(gated)/browse(gated)。
- **Knowledge(L2)** `src/knowledge/loader.ts` + `tools/knowledge.ts`：`search_knowledge`/`read_doc` 鎖 `knowledge/`。
- **Skills** `skills/<dir>/SKILL.md`（line1=name、line2=desc、body 按需 load_skill）。
- **Roles** `roles/roles.json`：persona + model + codingAgent + tools[] + skills[] + knowledge[] + actionMode(act/advise)。`saveRole` 寫回。新增＝改 JSON。
- **動作模式** `agent.ts`：`handle(...,actionMode?)`；advise 時工具過濾成 `READONLY_TOOLS`（唯讀諮詢）。per-role 預設 + 聊天即時切換。
- **Usage/Budget** `src/usage/` + `billing.json`：`.usage/ledger.jsonl` 記帳、budgetGate 擋超額。
- **Coding harness（可抽換）** `src/coding-agent/`：`factories` registry → `getCodingAgent()`/`listCodingAgents()`，`dispatch_coding_task` 委派。
- **Channels** `src/channels/`：cli/discord/web。Web REST 讀 `/api/roles|usage|tools|agents|sessions`，寫 `POST /api/roles/:id`；+ `/ws`。**Web UI** `web/`＝Next.js 15 + shadcn + Zustand（view: dashboard/session/settings；static export→`web/dist`）。
- **State** `WORKSPACE_DIR/`：`.sessions`（history）、`.memory`（per-session）。

## 規約地雷
ESM → 相對 import 一律 `.js` 副檔名；config 集中；`roles/`/`billing.json`/`knowledge/`/`skills/` cwd-relative → 從 repo 根跑；自動檢查只有 `npm run build`（tsc）＋ `npm --prefix web run build`（Next）。

## Onboarding 流程（給人）
1. 讀 repo 根 **`ARCHITECTURE.md`** —— 架構速覽 + **任務總列表** + 現在狀態（單一事實來源）。
2. 深度：`CLAUDE.md`（架構權威）、`HANDOFF.md`（交接背景、Task 3/4 詳規）、`knowledge/INDEX.md`（公司/產品知識）。
3. 找某模組 → 看 ARCHITECTURE.md §2 file 指標再開檔。

## 維護協定（重要）
`ARCHITECTURE.md` 是「架構 + 任務」的單一事實來源。每當：
- **完成/新增/變更任務** → 更新 §3 任務總列表狀態+摘要、§4 下一步、頂部「最後更新」日期。
- **動到架構**（新模組/工具/通道/角色欄位） → 更新 §2 架構速覽（並視需要同步 `CLAUDE.md`）。
保持精簡、可掃描；細節留給 `CLAUDE.md` / `knowledge/`。此 SKILL.md 的架構速覽也要跟著同步。
