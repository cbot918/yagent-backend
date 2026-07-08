# agent-os — Session Handoff

> ⚡ **快速掌握請先讀 `ARCHITECTURE.md`**（架構速覽 + **任務狀態總列表** + 現在狀態，由 `skills/agentos-arch` 維護）。本檔是詳細交接背景與 Task 3/4 規格。
> 撰寫於 2026-06-29；最後更新 **2026-07-05**（新增 §0.0 換機接手 checklist；delegate 已完成在 `feature/delegate`）。給「換 session／換機器後接手」用的無上下文交接文件。
> 先讀 `CLAUDE.md` 的 **「agent-os layer」** 章節（最權威的現況說明），再讀這份。
> 另有自動記憶在 `~/.claude/projects/-Users-yale-Documents-coding-ElementAI-openclaw-proj-yagent/memory/`（`agent-os-direction.md`、`claude-code-billing-caution.md`）。

---

## 0.0 換機接手 checklist（新機器上把專案跑起來）— 2026-07-05

> 目的：clone 到**另一台電腦**後，把 dev 環境完整重現。**最大陷阱：secret 檔沒進 git**（見下），clone 完不會有，一定要另外帶。

### A. git 現況（接手前先對齊）
- **開發分支＝`feature/delegate`**（比 `main` 領先 1 個 commit `645a105`，**尚未併回 main**）。`feature/memory` 已與 `main` 同步（無獨有 commit）。working tree 乾淨。
- production 從 **`main`** 部署（不是 `feature/*`）。要上線：`git checkout main && git merge --ff-only feature/delegate && git push origin main`，再 `redeployService`（見 §2.5）。
- `web/` 是 **embedded git repo（gitlink）**，自己的 remote/branch（`cbot918/yagent-web` `master`）。改 web 要在 `web/` 內另外 commit+push，再回根 `git add web` 更新 gitlink。

### B. ⚠️ 不進 git、必須「另外帶過去」的 secret 檔（.gitignore 擋掉）
clone 後這些檔**不存在**，需用非 git 管道（AirDrop / 1Password / scp / 隨身碟）從舊機複製，或重新從來源取得：
| 檔案 | 內容 | 怎麼補 |
|---|---|---|
| `.env`（repo 根） | `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` / `DISCORD_TOKEN` 等真值 | 從舊機複製，或照 `.env.example` 重填真 key |
| `kk`（repo 根） | Zeabur API token，格式 `zeabur: sk-...`（**冒號後**才是 token） | 從舊機複製，或到 Zeabur dashboard 重新產 token |
| `workspace/`（gitignored） | `.sessions/` `.memory/` `.usage/ledger.jsonl` 執行期狀態 | **不必帶**（重跑會重建）；要保留歷史/帳本才複製 |

> `web/.env.development`、`web/.env.production`、`.env.example`、`web/.env.example` **有進 git**（非 secret，只是後端 URL），會隨 clone 帶過來，不用管。

### C. 新機安裝步驟
```bash
# 1. runtime：Node >= 20（本機用 v22）。
node -v
# 2. 依賴：root 與 web/ 各自一份 package.json，兩個都要裝。
npm install
npm --prefix web install
# 3. 把 .env 和 kk 放回 repo 根（見 B）。
# 4. 冒煙測試（最快的 dev loop，不碰 Discord/token）：
npm run dev:cli
# 5. 自動檢查（唯一的 CI 等價物；沒有 test/lint runner）：
npm run build              # 後端 tsc（strict）
npm --prefix web run build # Next 型別檢查 + static export
```

### D. 外部 CLI / 選用依賴（依你要用的功能才需要）
| 依賴 | 何時需要 | 備註 |
|---|---|---|
| `claude` CLI | `CODING_AGENT=claude`（`dispatch_coding_task` 派給 Claude Code） | 本機為 v2.1.197。**計費：`ANTHROPIC_API_KEY` 沒設才吃訂閱**，設了就走 metered API（見自動記憶 `claude-code-billing-caution.md`）。 |
| `opencode` CLI | `CODING_AGENT=opencode` | 本機**未裝**；要用得 `npm i -g opencode` 之類並設 `OPENCODE_MODEL`+`OPENROUTER_API_KEY`。 |
| `npx playwright install chromium` | `ALLOW_BROWSER=true`（browse 工具） | 一次性。 |
| Docker / e2b | `SHELL_BACKEND=docker` 或 `e2b`（沙箱 shell） | 本機**無 Docker**；沒 Docker 就用 `SHELL_BACKEND=e2b`（需 `E2B_API_KEY`）或 `host`（無沙箱，僅 dev）。選 docker 但沒 Docker 會**大聲報錯不會偷偷 fallback**。 |

### E. 接手後第一步
1. 讀 `ARCHITECTURE.md`（架構+任務單一事實來源）→ `CLAUDE.md` 的「agent-os layer」→ 本檔。
2. 用 `yagent-architect` skill 快速拉齊專案心智模型（`load_skill yagent-architect`）。
3. `npm run dev:cli` 確認能跑，再 `npm run build` 確認綠燈，才開始改。

---

## 0. 一句話定位

`agent-os` = 蓋在 `yagent` 上的「編排/觸發/介面層」，包住**可抽換的 coding harness**，跑一個**虛擬公司**（手動切換 role），帶**費用/預算監測**。純自用、商業產品等級（**內容要專業，不要隨便生成大概的**）。

**重要決策：直接在 `yagent` repo 內就地開發**，不是複製到 `../agent-os/`（`../agent-os/HANDOFF.md` 只是最初的設計調研note，保留即可）。工作目錄＝`/Users/yale/Documents/coding/ElementAI/openclaw-proj/yagent`。

---

## 1. 目前已完成（builds green，已驗證）

前一個 session 已疊了三層 + web dashboard，`npm run build`（後端 tsc）與 `web` 的 `vue-tsc + vite build` 皆綠燈，`/api/roles`、`/api/usage` 已實機 curl 過。

**A. Agent-agnostic coding harness** — `src/coding-agent/`
- `types.ts`：`CodingAgent` 介面（`run(task, onEvent) → CodingResult`）+ `NormalizedEvent`。
- `index.ts`：`getCodingAgent(name=config.codingAgent)` 按 `CODING_AGENT` 切 `claude | opencode`（鏡像 `sandbox/index.ts` 的 switch+cache+shutdown cleanup）。
- `claude.ts`：spawn `claude -p --output-format stream-json --verbose`（+`--dangerously-skip-permissions` 若 `CLAUDE_YOLO`），parse NDJSON（`assistant`→事件、`result`→summary/`total_cost_usd`/`usage`）。**已對 Claude Code v2.1.183 驗證輸出格式。**
- `opencode.ts`：spawn `opencode run -m <model>`，OpenRouter 走 `OPENCODE_MODEL`+`OPENROUTER_API_KEY`。opencode 目前本機未安裝。
- `runtime.ts`：追蹤子行程、shutdown 時 killAll。
- 派工工具：`src/tools/dispatchCoding.ts`（`dispatch_coding_task`）—— 阻塞回傳 diff/摘要字串給 loop，過程 emit `dispatch:*` 到 bus。**Tool 介面沒改。**

**B. 虛擬公司 roles（手動切換 switchboard）** — `src/roles/`
- `types.ts`：`Role = { id, name, title?, emoji?, description, systemPrompt?, skill?, model?, codingAgent?, tools?[] }`。
- `loader.ts`：`loadRoles()` 讀 `roles/roles.json`、`getRole(id)`、`resolvePersona(role)`（inline systemPrompt 或載 skill body）、`DEFAULT_ROLE`。
- 種子資料 `roles/roles.json`：目前有 **ceo / coo / engineer**（範例級，**之後可能要被新角色取代或並存，待用戶決定**）。
- `src/agent.ts` 已 role-aware：`handle(sessionKey, text, roleId?)` → 解析 role → persona 進 system prompt、選 model、依 `role.tools` 過濾工具、設 `ctx.roleId`/`ctx.codingAgent`。
- `src/llm.ts` `complete()` 多了 `model` 參數。

**C. 費用/預算監測（觀測 + 上限執行）** — `src/usage/`
- `types.ts`：`UsageEntry / KeyAccount / Budget / BudgetStatus / BillingConfig`。
- `billing.ts`：讀 `billing.json`（keys、budgets、pricing 價表）+ `computeLlmCost()`。
- `ledger.ts`：append `.usage/ledger.jsonl`（files-as-truth）、`readUsage()`、`summarize()`。
- `index.ts`：`recordUsage()`（append+emit `cost:update`+超額 emit `budget:alert`）、`budgetGate()`（turn/dispatch 前置關卡，超額擋下）、`evaluateBudgets()`。
- 接點：`agent.ts` 每次 `complete()` 後 `recordUsage`、loop 前 `budgetGate`；`dispatchCoding.ts` run 前 gate、run 後 record。
- 種子 `billing.json`：keys(openrouter/openai/claude)、budgets(global $50、claude key $30)、pricing 表。

**D. 事件 / REST**（`src/events.ts`、`src/channels/web.ts`）
- `BaseEvent` 多了 `roleId?`。新事件：`dispatch:start|event|end`、`cost:update`、`budget:alert`。
- 新 REST：`GET /api/roles`、`GET /api/usage`（皆唯讀）。

**E. Web dashboard**（`web/`，**Next.js 15 App Router + shadcn/ui + Zustand**，static export → `web/dist`）
- `lib/types.ts`：鏡像上述事件 + Role/Usage 型別 + view model（`DispatchStep`、`Turn.dispatches`）。
- `lib/store.ts`（Zustand + immer）：`view: 'dashboard'|'session'`、`roles`、`usage`、`alerts`；actions `loadRoles/loadUsage/openRole/showDashboard`；`apply()` 處理 dispatch/cost/budget。
- `components/Dashboard.tsx`：grid 著陸頁 = **成員卡**（點→`openRole` 建 `web-<roleId>-<rand>` session 對談）+ **workflow 卡（停用佔位）** + **budget 面板**。
- `components/DispatchCard.tsx`：timeline 內渲染派工進度。`app/page.tsx` 切 dashboard↔session。`components/SessionView.tsx` 帶 roleId 送訊 + 顯示成員。
- `lib/useAgentSocket.ts` 的 `send(sessionKey, text, roleId?)`。

**規約/地雷**
- ESM + NodeNext：相對 import **一律 `.js` 副檔名**；config 集中 `src/config.ts`。
- `roles/roles.json`、`billing.json` 用 `path.resolve('./...')`，**cwd-relative → 一定要從 repo 根目錄跑**（`node dist/index.js` 要 `cd` 到 yagent 根）。
- **Claude 計費**：`dispatch CODING_AGENT=claude` 只有在 **`ANTHROPIC_API_KEY` 未設**時才吃訂閱，否則靜默走按量。在 Claude Code 自己的 sandbox Bash 裡 `claude -p` 會 401（`apiKeySource:none`）—— 那是 sandbox 取不到 OAuth，用戶真實終端機正常。
- 協定改動要同步 `web/lib/types.ts` + `web/lib/store.ts`（+ 日後 `mobile/lib/store.dart`，目前 **mobile 尚未跟進** agent-os 的新事件/端點）。
- 沒有 test/lint runner；`npm run build`（後端 tsc strict）＋ `npm --prefix web run build`（`next build`，含型別檢查 + 靜態匯出）是唯二自動檢查。

**指令**：`npm run dev:all`（後端:3001 + Vite:5173）→ 開 http://localhost:5173。`npm run dev:cli` 最快 dev loop。

---

## 2. 待辦（多 task 規劃，2026-06-29 用戶重新拆解）

> 用戶原話重點：**「我要專業的唷 不要隨便生成大概的，我這是商業產品。」** → role 的 persona/知識/技能必須專業、具體、可商用，不能是泛泛 template。

> 進度註記：**Task 1（web 前端重構為 Next.js + shadcn + Zustand）已完成並驗證**（見 §1.E）。
> roles.json 的 **13 個角色 persona 已由用戶寫好**（以 `docs/company-plan.md` 為策略源），所以原「新增角色」項目已不需要。

### Task 2 — 知識/技能層（**✅ 完成並驗證，2026-06-29**）

讓 13 個角色「專業可用」。已與用戶確認：**三項全做**、knowledge/ 為唯一文件庫、記憶走 knowledge/skills 檔案（**不動 `memory.ts`**，維持 per-session 對話記憶）。
> 驗證：backend+web build 綠燈；knowledge loader/tools/path-guard 單測過；**真 LLM E2E** — SA 角色問「接案報價檢查清單」自動 `read_doc finance/unit-economics.md` 並 grounded 回答 + 標來源。port 自動遞增實測 3001→3004。

1. **L2 知識庫 + 檢索工具**：建 `knowledge/` + `knowledge/INDEX.md`；`docs/company-plan.md` 移入 `knowledge/`。新增 `search_knowledge` + `read_doc` 兩個 tool（root 鎖在 `knowledge/`，沿用 `readFile.ts` 的 `resolveInWorkspace` path-guard 模式，另寫 `resolveInKnowledge`）；`src/index.ts` 註冊。
2. **各角色專業 SKILL.md**：為角色線撰寫專業 playbook（行銷漏斗/內容/PRD/系統設計/code 委派/DevOps runbook/報價…），放 `skills/`，按需 `load_skill`。
3. **角色綁定專屬知識**：`roles/roles.json` 為每個角色加 `knowledge?: string[]`（與 `skills?: string[]`），注入 system prompt 成「你的參考文件」並可被 search/read 檢索。
- 設計原則：分層 + 檔案優先 agentic retrieval（L1 常駐 INDEX / L2 隨選文件庫 / L3 才上向量 / L4 活資料走 MCP）；**不 fine-tune**；漸進式揭露（索引常駐、全文按需）。
- 順手：backend `web.ts` 加 **port 自動遞增**（EADDRINUSE 時 +1 往上找；但 PaaS 有 `process.env.PORT` 時不掃，照平台指定）。

### Task 3 — 權限/委派（**✅ 完成並驗證，2026-06-29**）

> 用戶 Q&A：(a)「給我個權限設定頁面，也可以設定各 agent 綁定的 model，然後預留一個 harness 或服務接口可以抽換」；(b)「互相委派 → 在每個 agent 上設計開關，可切換哪個角色要有動作或不要有動作（類似 plan mode / edit mode）」。

1. ✅ **權限設定頁**（`web/components/Settings.tsx`）：每角色 tools 白名單 + model + harness；`POST /api/roles/:id` 寫回 `roles.json`（`saveRole`）。入口：Dashboard ⚙ Settings 按鈕 + 角色卡 ⚙ 齒輪。
2. ✅ **可抽換 harness**：`coding-agent/index.ts` 的 `factories` registry（加 factory 即可）；`listCodingAgents()` → `GET /api/agents`，設定頁下拉選。
3. ✅ **動作開關**：`role.actionMode`（act/advise）per-role 預設 + 聊天室即時切換（`SessionView` 開關 → WS `send.actionMode` → `handle(...,actionMode)`）。advise 時工具過濾成 `READONLY_TOOLS`（讀檔/查知識/載技能），不能寫檔/shell/browse/dispatch。
> 驗證：backend+web build 綠燈；`/api/tools`、`/api/agents`、`POST /api/roles/:id` curl 過；UI 點齒輪→改 advise→儲存→寫回 roles.json；真 LLM E2E：engineer advise 模式被要求寫檔 → 零 mutating tool call。
> ⚠️ 協定有變（Role.actionMode、新 REST、WS send.actionMode），`mobile/` 仍未跟進。

### Task 4 — Sidebar 重構（**✅ 完成並驗證，2026-06-29**）

常駐左側 sidebar（`web/components/Sidebar.tsx`，桌機 static 欄 / 手機 `Sheet` drawer 共用），分四個可收合區：
- **Sessions** — 複用 `SessionList`（New web chat + 列表）。
- **Virtual company** — 角色精簡 row（點→`openRole`、齒輪→`showSettings(role.id)`）+ workflow `soon` 佔位 + 一行 `Projects · soon`（projects 未做）。
- **Budget & spend** — `web/components/BudgetPanel.tsx`：總花費 + budget 進度條，keys/subscriptions 收進可展開區（從 `Dashboard.tsx` 搬出）。
- **Settings** — 入口按鈕 → `showSettings()`（Task 3 設定頁，渲染於主內容區）。

主內容區依 `view` 切：`session`→`SessionView`、`settings`→`Settings`、`welcome`（預設）→歡迎空狀態。`Dashboard.tsx` 已刪；`store.ts` 的 `view` 去 `dashboard`、加 `welcome`，`showDashboard`→`showHome`（清 selected、回 welcome）。
> 驗證：`npm --prefix web run build` 綠燈；preview E2E（桌機四區渲染/可收合、角色 row 開聊、齒輪進角色設定、budget 展開 keys、手機 ☰ drawer 完整 sidebar）皆過，console 無 error。
> **純前端、未動後端/協定** → 此項不需同步 `mobile/`（但先前 Task 2/3 的新事件/端點 mobile 仍未跟進）。

### Task 6 — Room channels 多角色會議室（**✅ 完成並驗證，2026-07-08，feature/room-channels**）

拖角色進 channel、丟主題 → **moderator 選角**（一次小 LLM 呼叫挑 1–3 位相關成員，點名生效）→ 每位以完整 `runTurn` 依序發言（自己的 persona/工具/預算，子 session `room:<id>::<roleId>`，吃標註發言者的 transcript 增量）。
- 後端：`src/rooms/`（types/store/orchestrator，房間存 `.rooms/<id>.json`）、`room:message`/`room:round:*` 事件、`/api/rooms*` REST、`index.ts` 依 `room:` sessionKey 前綴路由到 `runRoomMessage`。WS `send` 協定不變。
- 前端：`RoomChannelsView.tsx`（角色 bench 拖進 channel / 點擊 fallback / chip ✕ 或拖回 bench 移除、發言 bubbles、「發言中」指示）；sidebar 加 Room channels 區並**預設全收合只留 Virtual company**。
- v1 邊界：固定一間 `main`（會議室）、用戶驅動輪次（無自動辯論）、無總結/匯出、mobile 未跟進。
> 驗證：兩邊 build 綠燈；真 LLM E2E — 丟 linebot 案主題 moderator 挑 pm+engineer 各自查知識庫後表態；UI 全鏈路 — 點名 CFO 只有 CFO 回、還引用 Engineer 的評估報價 NT$40k 並 @Sales；拖拉/點擊加退成員、round 指示、console 無 error。

---

## 2.5 部署現況 / Production（Zeabur）— 2026-06-29 首次上線

兩個 GitHub repo（**embedded git，分開部署**），各自 Zeabur 服務：

| 元件 | 本機路徑 | GitHub remote | branch | Zeabur 服務 | URL |
|---|---|---|---|---|---|
| Backend | repo 根 | `cbot918/yagent-backend` | `main` | `yagent-backend` | https://api-yagent.zeabur.app |
| Web | `web/`（nested repo） | `cbot918/yagent-web` | `master` | `yagent-web` | https://yagent1.zeabur.app |

> ⚠️ 後端在 `feature/memory` 開發，但 **production 從 `main` 部署** → 要上線得 `git checkout main && git merge --ff-only feature/memory && git push origin main`。web 直接在 `master`。
> ⚠️ web 是 **embedded git repo（gitlink）**，`web/node_modules`、`web/dist` 已 `git rm --cached` 不再追蹤（`.gitignore` 本來就忽略；部署是 build-from-source）。改完 web 要在 `web/` 內 commit + `git push origin master`，再回根 `git add web` 更新 gitlink。

**已上線 commit**：backend `b2b22ac`（main）、web `596820c`（master）。兩邊 build-from-source（backend tsc、web `next build`）。

> backend 現在有 root `Dockerfile`（Zeabur 偵測到就取代 zbpack）：base `node:22-bookworm-slim` + `playwright install --with-deps chromium`，讓 browse 工具／Threads browser source 在 prod 可用（還需 env `ALLOW_BROWSER=true`）。代價：image ~1.2GB、build 變慢；Chromium 跑起來吃 RAM，方案太小就把 `threadsHot.ts` 的 `CONCURRENCY` 調低。

**Zeabur 操作路徑（給 agent 用）**：token 放在 repo 根 `./kk`（gitignored），格式是 `zeabur: sk-xxx`（**冒號後那段**才是 token）。GraphQL endpoint `https://api.zeabur.com/graphql`，header `Authorization: Bearer <token>`。introspection 被關，常用查詢：
- 列服務：`query { projects { edges { node { _id name services { _id name } } } } }`
- 環境：`query { environments(projectID:"<proj>") { _id name } }`
- 讀環境變數：`query { service(_id:"<svc>"){ variables(environmentID:"<env>"){ key value } } }`
- 觸發重部署（rebuild from latest commit）：`mutation { redeployService(serviceID:"<svc>", environmentID:"<env>") }`
- 部署狀態：`query { deployments(serviceID, environmentID){ edges { node { _id status createdAt } } } }`；build log：`query { buildLogs(deploymentID:"<dep>"){ message timestamp } }`（亂序，要按 timestamp sort）。

**ID 速查**：project `Agent`=`6a030b0a58ee177a59cb6f9e`；env `production`=`6a030b0ae5ed304c1d84bdec`；svc `yagent-backend`=`6a21a020e957fb053c54e379`、`yagent-web`=`6a219a97e957fb053c54e2d2`。

**地雷 / 已知問題**：
1. **web 是 `output: 'export'` 靜態站** → Zeabur 預設會跑 `next start`（對 export 會 crash：`"next start" does not work with "output: export"`）。靠 `web/zbpack.json`（`build_command: npm run build` + `output_dir: dist`）強制當靜態站服務 `dist/`。**別刪這檔**。
2. **GitHub→Zeabur auto-deploy webhook 那次沒自動觸發**（push 後要手動 `redeployService`）。新 session 若 push 後 production 沒更新，先查 Zeabur↔GitHub app 連線，或直接 `redeployService`。
3. **env 已對齊**：backend Zeabur 變數與本機 `.env` 關鍵值一致，且已設 `WEB_ORIGIN=https://yagent1.zeabur.app`（CORS）。`PORT` 由平台注入別設。web 服務不需 runtime env（`NEXT_PUBLIC_API_BASE` 在 `web/.env.production` build 時 inline）。
4. **待清**：web 服務還留著舊 Vue 時代的死變數 `VITE_API_BASE`（Next 不讀，無害，可選擇刪）。
5. **持久化**：Zeabur 檔案系統 ephemeral → `.sessions/`、`.memory/`、`.usage/ledger.jsonl` 重新部署會消失，要持久得掛 volume（尚未處理）。

---

## 3. 需要先跟用戶釐清的問題（做之前務必互動，才能「專業而非泛泛」）

1. **公司的實際產品/領域是什麼？**（最關鍵）—— 沒有業務脈絡寫不出專業的 CTO/SA/Marketing persona。請用戶給：產品是什麼、目標客群、技術棧、商業模式。
2. **語言**：persona/知識/skills 要用繁中、英文、還是中英混？
3. **角色釐清**：
   - `Marketing` vs `數位行銷長 (CDMO)` 的分工/層級差異？（一個執行/經理層、一個 C-level 策略？）
   - `SA` 是指 **Solutions Architect / Systems Analyst / Sales**？（科技語境多半 Solutions Architect，需確認）
   - `Devops`、`CTO` 的職責邊界與彼此關係？
4. **既有 ceo/coo/engineer**：保留、取代、還是合併進新陣容？
5. **每角色的 harness/model**：哪些 role 要能 `dispatch_coding_task`（CTO/Devops/Engineer 類），哪些純諮詢（行銷類用便宜模型）？
6. **設定頁範圍**：只編 roles.json + billing.json，還是也要在 UI 管 knowledge 檔案與 MCP server 連線？MCP 管理是較大的一塊，要不要這輪就做？
7. ⚠️ **記憶模型決策**：目前 memory 是 **per-session**（`.memory/{sessionKey}.md`），**不是 per-role**。用戶要「給角色的記憶」→ 兩個選項，請確認方向：
   - (a) 角色長期知識改用 **skills / `knowledge/` 文件**承載（推薦，符合現架構）；
   - (b) 真要 per-role 持久記憶，需新增 role-scoped memory（例如 `.memory/role-<id>.md` 並在 system prompt 注入）—— 這要改 `memory.ts` 與 `agent.ts`。

---

## 4. 關鍵檔案地圖

```
src/
  agent.ts                role-aware loop + budgetGate + recordUsage 接點
  llm.ts                  complete(messages, tools, model)
  config.ts              所有 env（CODING_AGENT/CLAUDE_*/OPENCODE_*/OPENROUTER_API_KEY…）
  events.ts              AgentEvent union（含 dispatch:*/cost:*/budget:*、BaseEvent.roleId）
  coding-agent/          types/index/claude/opencode/runtime
  roles/                 types(+skills?/knowledge? 欄位)/loader  (+ 根目錄 roles/roles.json 資料)
  usage/                 types/billing/ledger/index  (+ 根目錄 billing.json 資料)
  knowledge/loader.ts    L2 文件庫：resolveInKnowledge(path guard)/listDocs/readIndex/readDoc/searchKnowledge
  tools/                 types(ToolContext)；readFile/writeFile(path guard 範本)/listFiles/
                         knowledge(search_knowledge+read_doc)/dispatchCoding…
  channels/web.ts        REST(handleApi) + /ws + listenWithRetry(port 自動遞增)；要加 settings 寫入端點就改這
  skills/loader.ts       skill 載入（name=line1, desc=line2, body 按需）
roles/roles.json          ★ 13 角色（已含 skills[]/knowledge[] 綁定）
knowledge/                ★ INDEX.md + company/ product/ engineering/ finance/ 文件庫（company-plan.md 已移入）
skills/                   ★ content-playbook/prd-writing/system-design/code-delegation/deploy-runbook/quoting-bd/brand-messaging
billing.json              ★ keys/budgets/pricing
web/  (Next.js 15 App Router + shadcn/ui + Zustand，static export → web/dist)
  lib/types.ts            ★ 協定鏡像（改後端事件要同步）
  lib/store.ts            ★ Zustand+immer：apply() reducer + view/roles/usage/alerts
  components/Dashboard.tsx 成員卡/workflow卡/budget面板（budget 要搬去 settings）
  app/page.tsx            view 切換（要加 'settings'）
  components/ui/          shadcn primitives（button/card/input/badge/collapsible/progress/sheet/scroll-area）
CLAUDE.md                 「agent-os layer」章節 = 現況權威說明
~/.claude/.../memory/     agent-os-direction.md, claude-code-billing-caution.md
```

計畫檔（舊）：`/Users/yale/.claude/plans/parsed-cooking-galaxy.md`（agent-os 整體分階段計畫，可參考）。

---

## 5. 接手後的建議第一步

先用第 3 節的問題跟用戶對齊（尤其 Q1 產品領域、Q3 角色定義、Q7 記憶模型），拿到業務脈絡後，再開始產 role 內容 + L2 知識工具 + 設定頁。**切勿在沒有業務脈絡下硬生成 persona** —— 用戶明確要求商用級、專業、不要泛泛。
