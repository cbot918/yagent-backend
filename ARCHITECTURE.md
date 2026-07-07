# AgentOS — Architecture & Tasks

> **開新 session 的單一入口**：先讀這份，掌握「這是什麼 + 架構速覽 + 任務總列表 + 現在狀態」。
> 深度參考：`CLAUDE.md`（架構權威）、`HANDOFF.md`（詳細交接背景與 Task 3/4 規格）、`knowledge/INDEX.md`（公司/產品知識）。
> **維護者**：`skills/agentos-arch`。完成/變更任務或動到架構時，回來更新本檔（§2 架構、§3 任務、§4 功能清單、§5 狀態）。最後更新：2026-06-30（新增 §4 功能清單；新增角色間委派 `delegate_to_role`，feature/delegate 分支）。

---

## 1. 這是什麼

`yagent` 是 OpenClaw 核心 agent 架構的極簡 TypeScript 重寫（COSCUP 2026 demo）。在其上就地疊了 **agent-os**：一個編排/觸發/介面層，包住**可抽換的 coding harness**，跑一個**虛擬公司**（13 個角色、手動切換），帶**費用/預算計量**。純自用、要求商業產品級品質、繁中優先。
工作目錄＝`/Users/yale/Documents/coding/ElementAI/openclaw-proj/yagent`。

## 2. 架構速覽（模組 → 檔案）

| 概念 | 檔案 | 重點 |
|---|---|---|
| Agent loop（核心） | `src/agent.ts` | role-aware：`runTurn(registry,opts)` 跑一回合並回傳 finalText（建 system prompt → ≤20 次 tool-calling → 存 history），`handle(...)` 是它 + `sendReply` 的薄包裝；`delegate_to_role` 也呼叫 `runTurn`。system prompt 每回合注入**公司 roster**（所有其他成員的 id/名稱/職稱，委派目標來源）。**動作模式**：`advise` 時工具過濾成唯讀（`READONLY_TOOLS`），`act` 用角色 tools 白名單。發 `bus` 事件、budgetGate/recordUsage。 |
| LLM | `src/llm.ts` | OpenAI-only；`complete(messages, tools, model)`。`OPENAI_BASE_URL` 可指 OpenRouter。 |
| Config | `src/config.ts` | 所有 env 集中於此（含 `portFromPaaS`）。 |
| Tools | `src/tools/` | `Tool` 介面；`ToolRegistry.run` catch 例外回字串。readFile/writeFile（`resolveInWorkspace` path guard）/listFiles/knowledge/dispatchCoding/**delegateRole（角色間委派）**/shell(gated)/browse(gated)。 |
| Knowledge（L2） | `src/knowledge/loader.ts` + `src/tools/knowledge.ts` | files-as-truth 文件庫，`search_knowledge`/`read_doc` 鎖在 `knowledge/`（`resolveInKnowledge`）。INDEX 常駐注入。 |
| Skills | `src/skills/loader.ts` + `skills/<dir>/SKILL.md` | line1=name、line2=desc、body 按需 `load_skill`。角色可用 `role.skills` 限定。 |
| Roles | `src/roles/` + `roles/roles.json` | 角色＝persona + model + codingAgent + tools[] + skills[] + knowledge[] + actionMode。13 角色。`saveRole(id,patch)` 寫回 JSON（給設定頁）。新增＝改 JSON。 |
| Coding harness 註冊 | `src/coding-agent/index.ts` | `factories` registry（可抽換接口）：`getCodingAgent()` + `listCodingAgents()`。加新 harness＝加一個 factory。 |
| REST API | `src/channels/web.ts` | 讀：`/api/roles`、`/api/usage`、`/api/sessions*`、`/api/tools`、`/api/agents`。寫：`POST /api/roles/:id`（存角色設定）。+ `/ws`、`/api/transcribe`。 |
| Usage/Budget | `src/usage/` + `billing.json` | `.usage/ledger.jsonl` 記帳；`budgetGate` 擋超額；`recordUsage` 發 `cost:update`/`budget:alert`。 |
| Coding agent（可抽換 harness） | `src/coding-agent/` | `getCodingAgent()` 按 `CODING_AGENT` 切 `claude`/`opencode`；`dispatch_coding_task` 委派。 |
| Channels | `src/channels/` | `cli` / `discord` / `web`（REST + `/ws`；`listenWithRetry` 本機自動找 port）。 |
| Events | `src/events.ts` | AgentEvent union（turn/llm/tool/dispatch:*/**delegate:***/cost:*/budget:*；BaseEvent.roleId）。 |
| Web UI | `web/` | Next.js 15 App Router + shadcn/ui + Zustand，static export → `web/dist`。**常駐左側 sidebar**（`components/Sidebar.tsx`：Sessions / Virtual company〔角色+workflow+projects〕/ Budget & spend / Settings；桌機 static 欄、手機 `Sheet` drawer；角色 row 有**執行中綠點**＝`selectActiveRoleIds`）。view：`welcome`/`session`/`settings`/**`role`**（`RoleView.tsx`＝點角色看其工作紀錄＝自身對話+受委派子 session，`roleForSession` 歸屬；「新對話」才開新 session）。委派可見性：`DelegateCard` 可點進 delegate 子 session、timeline working 行標出受委派角色名。`components/Settings.tsx`＝角色設定頁；`components/BudgetPanel.tsx`＝精簡花費。協定鏡像在 `web/lib/types.ts` + `web/lib/store.ts`。 |
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
| 5 | 角色間委派 `delegate_to_role` | ✅ 完成並驗證 | `runTurn` 抽出共用 + `delegate_to_role` 工具（深度上限 2、禁自我委派、子 session、花費記在 delegate 名下）；新 `delegate:*` 事件 + 前端 `DelegateCard` 鏡像。**真 LLM E2E 過**（PM→CFO + 三道 guard）。**feature/delegate 分支**，未併 main。 |

## 4. 功能清單 / 能力與邊界（Feature inventory）

> 「系統會什麼、不會什麼」的盤點。新增/移除能力時回來更新。狀態：✅ 已做並驗證｜⚠️ 有但有限制／陷阱｜❌ 沒做｜🔜 deferred（已規劃未做）。

### 4.1 已具備的能力（✅）

| 能力 | 狀態 | 邊界 / 說明 |
|---|---|---|
| 虛擬公司 13 角色，**手動切換 switchboard** | ✅ | 由**使用者挑一個角色**對話。角色**看得見彼此**（roster 注入 system prompt）並可**單次互相委派**（`delegate_to_role`，見下）。`roles/roles.json`。 |
| 角色可設定：persona / model / codingAgent / tools 白名單 / skills / knowledge / actionMode | ✅ | persona 檔案授權；其餘可在設定頁編輯，`POST /api/roles/:id` 寫回 JSON。 |
| Role-aware agent loop（≤20 輪 tool-calling、per-session lock、每回合重建 system prompt） | ✅ | `src/agent.ts`。 |
| 工具：read_file / write_file / list_files / save_memory / load_skill / search_knowledge / read_doc / dispatch_coding_task | ✅ | path-guard 鎖在 workspace/knowledge。 |
| 工具（gated）：shell / browse | ⚠️ | 需 `ALLOW_SHELL` / `ALLOW_BROWSER`；shell 有沙箱後端，browse 有 SSRF guard。 |
| **委派寫程式 `dispatch_coding_task` → 外部 coding harness** | ✅ | 派給 **Claude Code / opencode**（不是派給角色）。harness 可抽換（registry/factories）。 |
| **角色間委派 `delegate_to_role`（role → role）** | ✅ | 一個角色把子任務交給另一個成員跑一個完整 turn（delegate 用自己的 persona/model/工具/權限/動作模式），結果回傳給呼叫者的 loop。深度上限 2、禁自我委派、跑在子 session `<caller>::<role>`、花費記在 delegate 角色名下。**roster 注入 system prompt**，角色才知道有哪些同事/role id 可委派（2026-07-08 修）。`src/tools/delegateRole.ts` + `runTurn`（`agent.ts`）。 |
| 動作模式 act / advise（per-role 預設 + 每回合覆寫） | ✅ | advise 時工具過濾成唯讀 `READONLY_TOOLS`。 |
| L2 知識庫（INDEX 常駐 + search_knowledge / read_doc 隨選） | ✅ | files-as-truth，無向量庫；角色可綁 `knowledge[]`。 |
| Skills（SKILL.md，`load_skill` 隨選，可 role-scoped） | ✅ | |
| 費用/預算計量（ledger.jsonl + budgetGate 前置關卡 + cost:update/budget:alert + 前端即時累加） | ⚠️ | 管線完整，但 cost 是**本地價表估算**（`computeLlmCost`）。**價表沒列的 model（如 minimax）→ 算成 $0**，所以花費條不動。補 `billing.json` pricing 即可。 |
| Channels：cli / discord / web（REST + WS） | ✅ | |
| Web UI：常駐 sidebar（Sessions / Virtual company / Budget & spend / Settings）+ 設定頁 + DispatchCard + 每 session 動作模式開關 | ✅ | Next.js 靜態匯出。 |
| 持久化：files-as-truth（`.sessions/`、`.memory/`、`.usage/`） | ✅ | per-session memory（見 §4.2）。 |
| Production 部署（Zeabur，兩 repo） | ⚠️ | FS ephemeral，redeploy 會清掉 ledger/sessions/memory（未掛 volume）。詳 `HANDOFF.md §2.5`。 |

### 4.2 尚未具備 / 常見誤會（❌ / 🔜）

| 缺口 | 狀態 | 說明 |
|---|---|---|
| 多角色編排 / workflow node-graph designer | 🔜 deferred | sidebar 留了 `soon` 佔位。`delegate_to_role`（§4.1）已支援**單次**角色間委派（PM 可主動把實作交給 engineer）；這裡缺的是**圖形化、多步、可預先設計**的常駐 workflow 編排。 |
| Projects | 🔜 deferred | sidebar `soon` 佔位。 |
| Per-role 持久記憶 | ❌ | 記憶目前是 **per-session**（`.memory/{sessionKey}.md`），不是 per-role。角色長期知識走 skills / knowledge 檔。 |
| Mobile 跟進 agent-os 新事件/端點 | ❌ | `mobile/` 尚未支援 dispatch:*/cost:*/budget:*、roleId、role/usage REST。 |
| UI 管理 knowledge 檔案 / MCP server 連線 | ❌ | 設定頁只編 roles.json。 |

## 5. 現在狀態 / 下一步

- **下一步**：Task 1–5 皆完成並驗證（Task 5 角色間委派在 **feature/delegate** 分支，尚未併回 main / web master，也未跟進 mobile）。剩餘 deferred：workflow node-graph designer（sidebar 已留 `soon` 佔位）、projects、mobile 跟進 agent-os 新事件/端點（含 `delegate:*`）。
- **billing**：`billing.json` 已補 `minimax/minimax-m2.5` 價格（input $0.3 / output $1.2 每 M，**估值待校**），所以新對話的花費數字才會動；舊 ledger 紀錄的 `costUSD` 不回算。
- **🚀 Production 已上線（Zeabur，2026-06-29）**：web https://yagent1.zeabur.app、backend https://api-yagent.zeabur.app，皆實機 200 驗證過。部署拓樸 / Zeabur API token（`./kk`）/ 重部署指令 / 地雷（web 靜態站 `zbpack.json`、main vs feature/memory branch）全在 **`HANDOFF.md` §2.5**。
- **Task 4 產物**：`web/components/Sidebar.tsx`（殼+四區）、`BudgetPanel.tsx`（精簡花費，從 Dashboard 搬出）；移除 `Dashboard.tsx`；`store.ts` 的 `view` 去 `dashboard`、加 `welcome`，`showDashboard`→`showHome`；`page.tsx` 改成常駐 sidebar + 依 view 切主區。純前端、未動後端/協定，故 `mobile/` 無需跟進此項。
- **本機 dev 注意**：前端 `web/.env.development` 預設指 `localhost:3001`，所以 **backend 要在 3001**；建議**先起 backend（`npm run dev:web`）再起 Next（`npm --prefix web run dev`）**，避免 Next 搶 3001。看終端機印的網址開頁。**別**直接看 backend serve 的 `web/dist`（那是用 `.env.production` build、指向 zeabur，本機抓不到資料）。
- backend `:PORT` 被佔時會自動往上找（PaaS 注入 `PORT` 時則照平台指定不掃）。
