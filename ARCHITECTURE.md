# AgentOS — Architecture & Tasks

> **開新 session 的單一入口**：先讀這份，掌握「這是什麼 + 架構速覽 + 任務總列表 + 現在狀態」。
> 深度參考：`CLAUDE.md`（架構權威）、`HANDOFF.md`（詳細交接背景與 Task 3/4 規格）、`knowledge/INDEX.md`（公司/產品知識）。
> **維護者**：`skills/agentos-arch`。完成/變更任務或動到架構時，回來更新本檔（§3 任務、§2 架構、§4 狀態）。最後更新：2026-06-29（Task 4 完成）。

---

## 1. 這是什麼

`yagent` 是 OpenClaw 核心 agent 架構的極簡 TypeScript 重寫（COSCUP 2026 demo）。在其上就地疊了 **agent-os**：一個編排/觸發/介面層，包住**可抽換的 coding harness**，跑一個**虛擬公司**（13 個角色、手動切換），帶**費用/預算計量**。純自用、要求商業產品級品質、繁中優先。
工作目錄＝`/Users/yale/Documents/coding/ElementAI/openclaw-proj/yagent`。

## 2. 架構速覽（模組 → 檔案）

| 概念 | 檔案 | 重點 |
|---|---|---|
| Agent loop（核心） | `src/agent.ts` | role-aware：`handle(sessionKey,text,roleId?,actionMode?)`。每回合重建 system prompt → ≤20 次 tool-calling 迴圈 → 存 history → `sendReply`。**動作模式**：`advise` 時工具過濾成唯讀（`READONLY_TOOLS`），`act` 用角色 tools 白名單。發 `bus` 事件、budgetGate/recordUsage。 |
| LLM | `src/llm.ts` | OpenAI-only；`complete(messages, tools, model)`。`OPENAI_BASE_URL` 可指 OpenRouter。 |
| Config | `src/config.ts` | 所有 env 集中於此（含 `portFromPaaS`）。 |
| Tools | `src/tools/` | `Tool` 介面；`ToolRegistry.run` catch 例外回字串。readFile/writeFile（`resolveInWorkspace` path guard）/listFiles/knowledge/dispatchCoding/shell(gated)/browse(gated)。 |
| Knowledge（L2） | `src/knowledge/loader.ts` + `src/tools/knowledge.ts` | files-as-truth 文件庫，`search_knowledge`/`read_doc` 鎖在 `knowledge/`（`resolveInKnowledge`）。INDEX 常駐注入。 |
| Skills | `src/skills/loader.ts` + `skills/<dir>/SKILL.md` | line1=name、line2=desc、body 按需 `load_skill`。角色可用 `role.skills` 限定。 |
| Roles | `src/roles/` + `roles/roles.json` | 角色＝persona + model + codingAgent + tools[] + skills[] + knowledge[] + actionMode。13 角色。`saveRole(id,patch)` 寫回 JSON（給設定頁）。新增＝改 JSON。 |
| Coding harness 註冊 | `src/coding-agent/index.ts` | `factories` registry（可抽換接口）：`getCodingAgent()` + `listCodingAgents()`。加新 harness＝加一個 factory。 |
| REST API | `src/channels/web.ts` | 讀：`/api/roles`、`/api/usage`、`/api/sessions*`、`/api/tools`、`/api/agents`。寫：`POST /api/roles/:id`（存角色設定）。+ `/ws`、`/api/transcribe`。 |
| Usage/Budget | `src/usage/` + `billing.json` | `.usage/ledger.jsonl` 記帳；`budgetGate` 擋超額；`recordUsage` 發 `cost:update`/`budget:alert`。 |
| Coding agent（可抽換 harness） | `src/coding-agent/` | `getCodingAgent()` 按 `CODING_AGENT` 切 `claude`/`opencode`；`dispatch_coding_task` 委派。 |
| Channels | `src/channels/` | `cli` / `discord` / `web`（REST + `/ws`；`listenWithRetry` 本機自動找 port）。 |
| Events | `src/events.ts` | AgentEvent union（turn/llm/tool/dispatch:*/cost:*/budget:*；BaseEvent.roleId）。 |
| Web UI | `web/` | Next.js 15 App Router + shadcn/ui + Zustand，static export → `web/dist`。**常駐左側 sidebar**（`components/Sidebar.tsx`：Sessions / Virtual company〔角色+workflow+projects〕/ Budget & spend / Settings；桌機 static 欄、手機 `Sheet` drawer）。view：`welcome`/`session`/`settings`，主內容區依此切換。`components/Settings.tsx`＝角色權限/model/harness/動作模式設定頁；`components/BudgetPanel.tsx`＝sidebar 精簡花費面板。協定鏡像在 `web/lib/types.ts` + `web/lib/store.ts`。 |
| Mobile | `mobile/` | Flutter，協定相容客戶端；**尚未跟進 agent-os 新事件/端點**。 |
| State（files-as-truth） | `WORKSPACE_DIR/` | `.sessions/{key}.json`（history）、`.memory/{key}.md`（per-session memory）。 |

**規約地雷（最常踩）**：① ESM + NodeNext → 相對 import 一律 `.js` 副檔名；② config 集中 `src/config.ts`，別處別讀 `process.env`；③ `roles/roles.json`、`billing.json`、`knowledge/`、`skills/` 都 cwd-relative → **一定從 repo 根目錄跑**；④ 無 test/lint runner，自動檢查只有 `npm run build`（後端 tsc）＋ `npm --prefix web run build`（Next 型別+匯出）。

## 3. 任務總列表（master task list）

| # | Task | 狀態 | 摘要（詳規見 HANDOFF.md §2） |
|---|---|---|---|
| 1 | web 前端重構 → Next.js + shadcn + Zustand | ✅ 完成並驗證 | 砍 Vue，static export→`web/dist`，功能/外觀不變。E2E 過。 |
| 2 | 知識/技能層（L2 知識庫 + 工具 + 角色綁定） | ✅ 完成並驗證 | `knowledge/` + `search_knowledge`/`read_doc`；7 個專業 SKILL.md；13 角色綁 knowledge[]/skills[]。真 LLM E2E 過。順帶修 backend port 自動遞增。 |
| 3 | 權限/委派 | ✅ 完成並驗證 | 設定頁（每角色 tools 白名單 + model + harness）寫回 roles.json（`POST /api/roles/:id`）；harness registry 可擴充（`/api/agents`）；**動作模式** act/advise＝per-role 預設 + 聊天即時切換，advise 過濾成唯讀工具。E2E 過。 |
| 4 | Sidebar 重構 | ✅ 完成並驗證 | 常駐左側 sidebar（`Sidebar.tsx`）分四區：Sessions / Virtual company（角色+workflow+projects 佔位）/ Budget & spend（`BudgetPanel.tsx` 精簡+可展開）/ Settings。移除獨立 Dashboard 全頁，主區改 `welcome`/`session`/`settings`。桌機 static 欄、手機 `Sheet` drawer。build 綠燈 + preview E2E 過。 |

## 4. 現在狀態 / 下一步

- **下一步**：四個規劃任務（Task 1–4）皆完成並驗證。剩餘 deferred：workflow node-graph designer（sidebar 已留 `soon` 佔位）、projects、mobile 跟進 agent-os 新事件/端點。
- **Task 4 產物**：`web/components/Sidebar.tsx`（殼+四區）、`BudgetPanel.tsx`（精簡花費，從 Dashboard 搬出）；移除 `Dashboard.tsx`；`store.ts` 的 `view` 去 `dashboard`、加 `welcome`，`showDashboard`→`showHome`；`page.tsx` 改成常駐 sidebar + 依 view 切主區。純前端、未動後端/協定，故 `mobile/` 無需跟進此項。
- **本機 dev 注意**：前端 `web/.env.development` 預設指 `localhost:3001`，所以 **backend 要在 3001**；建議**先起 backend（`npm run dev:web`）再起 Next（`npm --prefix web run dev`）**，避免 Next 搶 3001。看終端機印的網址開頁。**別**直接看 backend serve 的 `web/dist`（那是用 `.env.production` build、指向 zeabur，本機抓不到資料）。
- backend `:PORT` 被佔時會自動往上找（PaaS 注入 `PORT` 時則照平台指定不掃）。
