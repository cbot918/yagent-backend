# yagent-architect
yagent / agent-os 的深度開發架構師：懂每個模組的職責、資料流、規約地雷與「要改 X 該動哪裡」的擴充食譜，開發時直接給精準落點。

## 何時用
- 要在 yagent/agent-os 上**動程式**（加/改工具、角色、技能、知識、coding harness、通道、事件、REST 端點）。
- 要理解一次 turn 的**完整資料流**（含 delegate / dispatch 分支）或除錯。
- 要確認「改了 A 還要同步哪些地方」（協定鏡像、path guard、config 集中…）。
- 分工：本 skill＝**開發落點與規約**；`agentos-arch`＝**onboarding + `ARCHITECTURE.md` 任務總列表維護**。動到架構時兩邊都要同步。

## 專案本質（一句話）
`yagent`＝OpenClaw 核心 agent 架構的極簡 TS 重寫（COSCUP 2026 教材，**清楚 > 聰明**，模組 1:1 對應演講概念）。其上就地疊 **agent-os**＝編排/觸發/介面層：**可抽換 coding harness** + **13 角色虛擬公司（手動切換 switchboard）** + **費用/預算計量**。純自用、商業級品質、繁中優先。

## 不可動搖的設計不變量（invariants）
1. **files-as-truth**：sessions/memory/usage/roles/billing/knowledge/skills 全是檔案，**無 DB、無 vector store**。retrieval 用 grep-style。
2. **單一 swap point**：LLM（`llm.ts`）、sandbox（`Executor`）、coding harness（`CodingAgent`）都是「一介面一 factory」，換後端只動一處。
3. **加能力盡量不寫 code**：加 skill/knowledge/role＝純檔案建立（skill＝新 `SKILL.md`；knowledge＝新 `.md`；role＝改 `roles/roles.json`）。
4. **system prompt 每回合重建**（`buildSystemPrompt`）→ memory/skills/role 改了**立即生效**，不需重啟。
5. **history 每回合全量重放**，無摘要/截斷（只有 20 iteration 上限）。
6. **工具失敗不炸 loop**：`ToolRegistry.run` catch 例外回 `Error: ...` 字串；turn 失敗在 `agent.ts` 收成 `[agent error] ...` 文字。

## 一次 turn 的資料流（核心心智模型）
`handle(sessionKey, text, roleId?, actionMode?)` = `runTurn(...)` + `channel.sendReply`（`src/agent.ts`）：
1. `withSessionLock`（同 session 併發序列化）。
2. 解析 role（`getRole`）→ `buildSystemPrompt` = persona（inline 或 `skill` body）+ 當前 memory + 角色技能清單 + 綁定 knowledge + 常駐 `knowledge/INDEX.md` + workspace 路徑。
3. **動作模式**：`advise` → 工具過濾成 `READONLY_TOOLS`（read_file/list_files/search_knowledge/read_doc/load_skill）；`act` → 用 `role.tools` 白名單。
4. **`budgetGate()`** 前置關卡（超額擋下）。
5. tool-calling 迴圈（≤20）：`complete(messages, tools, model)` → 有 `tool_calls` 就逐一 `ToolRegistry.run`（傳 `ctx`：workspaceDir/sessionKey/roleId/codingAgent）→ append `role:'tool'` 結果 → 重跑；否則文字回覆結束。
6. 每次 `complete()` 後 `recordUsage()`（append `.usage/ledger.jsonl` + emit `cost:update`，超額 emit `budget:alert`）。
7. 存 history（去掉 system prompt）→ 回傳 finalText。
8. 全程 emit `AgentEvent` 到 `bus`（web 通道 fan-out 到 `/ws`；cli/discord 只靠 `sendReply`）。

**兩個委派分支（別搞混）**：
- **`dispatch_coding_task`**（`tools/dispatchCoding.ts`）：派給**外部 coding harness**（Claude Code / opencode），阻塞回傳 diff/摘要字串，emit `dispatch:*`。
- **`delegate_to_role`**（`tools/delegateRole.ts`）：派給**另一個角色**，該角色跑一個完整 `runTurn`（用自己的 persona/model/tools/actionMode）在子 session `<caller>::<role>`，結果回呼叫者 loop。emit `delegate:*`。guard：深度上限 `MAX_DELEGATION_DEPTH`(2)、禁自我委派、未知角色拒絕、花費記在 delegate 名下。這是**單次任務委派**，不是 workflow node-graph（後者仍 deferred）。

## 模組地圖（要改 X → 開這裡）
| 要做的事 | 檔案 |
|---|---|
| 改 agent loop / 動作模式 / budget 接點 | `src/agent.ts`（`runTurn`/`handle`/`buildSystemPrompt`/`READONLY_TOOLS`） |
| 換/調 LLM 呼叫 | `src/llm.ts`（`complete(messages,tools,model)`；`OPENAI_BASE_URL` 指 OpenRouter） |
| 讀任何 env | **只**在 `src/config.ts`（別處別碰 `process.env`） |
| 加/改工具 | `src/tools/*.ts` + 在 `src/index.ts` 註冊 |
| 加/改角色 | `roles/roles.json`（資料）；欄位型別 `src/roles/types.ts`；載入 `src/roles/loader.ts` |
| 加/改技能 | `skills/<dir>/SKILL.md`（line1=name、line2=desc、body 按需 `load_skill`） |
| 加/改知識 | `knowledge/<area>/*.md` + 更新 `knowledge/INDEX.md`；loader `src/knowledge/loader.ts` |
| 加 coding harness 後端 | `src/coding-agent/`（實作 `CodingAgent`）+ `index.ts` 的 `factories` map |
| 加 sandbox 後端 | `src/sandbox/`（實作 `Executor`）+ `index.ts` 的 switch |
| 加事件型別 | `src/events.ts`（`AgentEvent` union） |
| 加/改 REST 或 WS | `src/channels/web.ts`（`handleApi` + `/ws` + `listenWithRetry`） |
| 加通道 | `src/channels/`（實作 `Channel`：name/start/sendReply）+ `src/index.ts` 掛上 |
| 費用/預算/價表 | `src/usage/*` + `billing.json`（keys/budgets/pricing） |
| Web UI | `web/`（Next.js 15 App Router + shadcn + Zustand；`lib/store.ts` 的 `apply()` reducer、`lib/types.ts` 協定鏡像、`components/*`） |

## 擴充食譜（含必須同步的落點）
- **加工具**：實作 `Tool`（name/description/JSON-schema parameters/`run(args,ctx)→string`）→ 在 `src/index.ts` 註冊。寫檔類工具**必用 `resolveInWorkspace`** path guard（範本見 `writeFile.ts`）。若要 advise 模式也能用→加進 `READONLY_TOOLS`。
- **加角色**：改 `roles/roles.json`（persona 走 inline `systemPrompt` 或 `skill`；可設 `model`/`codingAgent`/`tools[]`/`skills[]`/`knowledge[]`/`actionMode`）。UI 設定頁可寫回（`POST /api/roles/:id` → `saveRole`），但 persona 檔案授權。
- **加 coding harness**：`src/coding-agent/<name>.ts` 實作 `CodingAgent`（`run(task,onEvent)→CodingResult`）→ 加進 `index.ts` `factories` → 自動出現在 `/api/agents`、可 per-role 選。
- **加事件 / 改協定**：`src/events.ts` 改完，**必鏡像** `web/lib/types.ts` + `web/lib/store.ts`（reducer），**且**（下次動 mobile 時）`mobile/lib/models.dart` + `mobile/lib/store.dart`。⚠️ mobile 目前落後（未跟進 dispatch/cost/delegate/roleId/role-usage 端點）。
- **加 REST 端點**：`src/channels/web.ts` `handleApi`；跨網域記得 CORS（`WEB_ORIGIN`/`config.webOrigin` 預設 `*`）。

## 規約地雷（最常踩）
1. **ESM + NodeNext**：相對 import **一律 `.js` 副檔名**（source 是 `.ts` 也要寫 `.js`），漏了 build 就爛。
2. **config 集中**：只在 `src/config.ts` 讀 env。
3. **cwd-relative**：`roles/roles.json`、`billing.json`、`knowledge/`、`skills/` 都相對 cwd → **一定從 repo 根跑**（`npm run dev:*` 都在根）。
4. **path guard**：檔案工具鎖在 `ctx.workspaceDir`（`resolveInWorkspace`）、knowledge 鎖在 `knowledge/`（`resolveInKnowledge`）—— 用 `path.relative` + 拒 `../`/absolute，別用可繞過的 `startsWith`。
5. **協定鏡像**：後端事件/REST 形狀改了，`web/`（必）與 `mobile/`（欠）都要同步。
6. **無 test/lint runner**：自動檢查只有 `npm run build`（後端 tsc strict）+ `npm --prefix web run build`（Next 型別+匯出）。「跑測試」＝手動用 `npm run dev:cli` 或 web UI 走一遍。

## 已知陷阱 / 邊界（省你踩坑）
- **記憶是 per-session 不是 per-role**（`.memory/{sessionKey}.md`）。要「角色長期知識」→ 走 skills/knowledge 檔（推薦），真要 per-role 記憶得改 `memory.ts`+`agent.ts`。
- **費用是本地價表估算**（`computeLlmCost`）；`billing.json` pricing **沒列的 model → 算成 $0**，花費條不動 → 補 pricing 即可。
- **Claude 計費**：`dispatch_coding_task` 走 `claude` 登入吃訂閱**只在 `ANTHROPIC_API_KEY` 未設時**；設了就靜默走 metered API。
- **Zeabur FS ephemeral**：redeploy 清掉 `.sessions/`/`.memory/`/`.usage/`（未掛 volume）。
- **backend port 本機自動遞增**（`listenWithRetry`）；PaaS 注入的 `PORT` 優先於 `WEB_PORT`。
- **web 是 `output:'export'` 靜態站**：靠 `web/zbpack.json` 讓 Zeabur 當靜態站服務 `dist/`，**別刪**（否則 `next start` 對 export 會 crash）。

## 驗證流程（改完怎麼確認）
1. 型別：`npm run build`（+ 動 web 時 `npm --prefix web run build`）。
2. 行為：`npm run dev:cli`（最快，不碰 Discord/token）走一遍；或 `npm run dev:all`（backend + Next dev）看 web timeline。
3. 前端可視變更用 preview 工具（見專案 preview workflow），別叫用戶手動看。

## 文件同步義務（改完回來更新）
- 動到架構（新模組/工具/通道/角色欄位/事件）→ 更新 `ARCHITECTURE.md` §2/§3/§4 + `CLAUDE.md` 的「agent-os layer」章節；`agentos-arch` skill 的速覽也要同步。
- 換機/部署相關變更 → 更新 `HANDOFF.md` §0.0 / §2.5。
- 單一事實來源優先序：`CLAUDE.md`（架構權威）＞ `ARCHITECTURE.md`（架構+任務）＞ `HANDOFF.md`（交接背景）＞本 skill（開發落點）。彼此矛盾時以 `CLAUDE.md` 為準並修正其他。
