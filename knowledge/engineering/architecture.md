# yagent / AgentOS 架構摘要（給 Engineer / SA / DevOps / QA）

> 權威來源是 repo 根目錄的 `CLAUDE.md`；這份是給角色快速取用的精煉版。動 code 前以 `CLAUDE.md` 為準。

## 模組對應（每個模組 1:1 對應一個概念）

- **Gateway / Agent loop** — `src/agent.ts`：`createAgent(registry, channel)`。每則訊息：取 per-session lock → 每回合重建 system prompt（persona + memory + skills + 知識 INDEX + workspace）→ 跑最多 20 次 tool-calling 迴圈 → 存 history → `sendReply`。全程在 `bus`（`src/events.ts`）發 `turn/llm/tool/dispatch/cost/budget` 事件。
- **LLM** — `src/llm.ts`：OpenAI-only（`OPENAI_BASE_URL` 可指 OpenRouter）。`complete(messages, tools, model)`。
- **Tools** — `src/tools/`：實作 `Tool` 介面（name/description/JSON-schema parameters/`run(args, ctx)→string`）。`ToolRegistry.run` 會 catch 例外回成字串，不讓 loop 崩。寫檔工具用 `resolveInWorkspace` 鎖在 workspace 內。
- **Knowledge** — `src/knowledge/loader.ts` + `src/tools/knowledge.ts`：L2 文件庫，`search_knowledge` / `read_doc` 鎖在 `knowledge/`。
- **Skills** — `skills/<dir>/SKILL.md`：第 1 行 name、第 2 行 description；全文按需 `load_skill`。新增 skill＝純建檔。
- **Roles** — `src/roles/` + `roles/roles.json`：角色＝persona + model + codingAgent + tools 白名單 + skills + knowledge。新增角色＝改 JSON。
- **Usage/Budget** — `src/usage/` + `billing.json`：`.usage/ledger.jsonl` 記帳；`budgetGate()` 回合/委派前擋超額；`recordUsage()` 記帳並發 `cost:update`/`budget:alert`。
- **Coding agent（可抽換 harness）** — `src/coding-agent/`：`getCodingAgent()` 按 `CODING_AGENT` 切 `claude` / `opencode`。透過 `dispatch_coding_task` 委派。
- **Channels** — `src/channels/`：`cli` / `discord` / `web`（REST + `/ws`）。
- **State（files-as-truth）** — `WORKSPACE_DIR` 下：`.sessions/{key}.json`（history）、`.memory/{key}.md`（memory）。

## 規約（動 code 必守）

- **ESM + NodeNext**：相對 import 一律 `.js` 副檔名（即使源碼是 `.ts`）。
- **Config 集中**在 `src/config.ts`（env via dotenv），別在別處讀 `process.env`。
- `roles/roles.json`、`billing.json` 用 cwd-relative path → 一定從 repo 根目錄跑。
- **無 test/lint runner**：自動檢查只有 `npm run build`（後端 tsc strict）＋ `npm --prefix web run build`（Next 型別檢查 + 靜態匯出）。其餘靠手動驗證。

## 前端

`web/` = Next.js 15 App Router + shadcn/ui + Zustand（static export → `web/dist`）。協定鏡像在 `web/lib/types.ts` + `web/lib/store.ts`，改後端事件要同步。

## 部署

Zeabur；後端 `PORT` 由平台注入。前端走 split-deploy（`NEXT_PUBLIC_API_BASE` 指向後端）。沙箱 `SHELL_BACKEND=host|docker|e2b`。
