# Deploy & Ops Runbook
部署、CI、sandbox、環境與可靠度的操作手冊：Zeabur 部署、env/secrets、回滾，固定成本先對齊 CFO。

## 何時用
部署、環境設定、沙箱/CI、可觀測性與回滾，或評估維運成本時。

## 部署（Zeabur）
- 後端 `PORT` 由平台注入（`config.webPort` 讀 `PORT` → `WEB_PORT` → 3001）。**勿在 prod 自動改 port**。
- 前端 split-deploy：build 時設 `NEXT_PUBLIC_API_BASE` 指向後端；靜態匯出 `web/dist`。
- 後端 monolith 也可服務 `web/dist`（SPA fallback）。

## Sandbox / 工具安全
- Shell 走 `SHELL_BACKEND=host|docker|e2b`（`host` 僅開發，prod 用 docker/e2b 隔離）。
- `ALLOW_SHELL` / `ALLOW_BROWSER` 預設關；要開要評估風險。
- 沙箱以 sessionKey 復用；關閉時 `disposeAll` 清理。

## Secrets / Env
- 全部走 `src/config.ts`（dotenv）。`.env` 不進版控。
- LLM/coding harness 金鑰：注意 Claude harness 只有在 `ANTHROPIC_API_KEY` 未設時才吃訂閱，否則靜默按量計費。

## 可靠度
- 一次只改一個變數，留回滾路徑。
- 任何**增加固定成本**的東西（常駐服務、付費方案）先跟 CFO 對齊單位經濟（見 [[unit-economics]]）。
- 觀測：用量看 `.usage/ledger.jsonl` 與 budget 面板。

## 動 code
需要改部署相關 code 時用 `dispatch_coding_task` 委派並嚴審（見 [[code-delegation]]）。架構見 [[architecture]]。
