# AgentOS 產品總覽（給 PM / SA / Sales / Engineer）

> AgentOS = 本 repo（yagent）對外的產品。這份是「能做什麼、怎麼賣、怎麼劃 scope」的共用底稿。
> 技術細節見 [[architecture]]；策略定位見 [[company-plan]]；對外用語見 [[brand-voice]]。

## 1. 一句話

一個能跑「虛擬公司角色」（行銷／客服／文件／排程／工程）的 agent OS，幫中小企業老闆把重複性營運工作自動化，且**用量與成本看得到、管得住**。

## 2. 現有能力（可對客戶承諾的）

- **多角色虛擬公司**：可手動切換不同 AI 員工（角色＝persona + 綁定 model/harness/工具/知識）。新增成員＝改 `roles/roles.json`，不用改 code。
- **工具執行**：讀寫檔案、列檔、（可選）shell sandbox、（可選）瀏覽器 browse。
- **知識庫（L2）**：`knowledge/` 文件庫 + `search_knowledge` / `read_doc`，讓角色根據公司知識回答，不亂編。
- **委派 coding**：`dispatch_coding_task` 把重活丟給可抽換的 coding harness（claude / opencode），拿回 diff 審查。
- **成本/預算計量**：每次 LLM 呼叫與委派都記帳（`.usage/ledger.jsonl`），可設全域/供應商/key/角色層級預算上限，超額即擋。**這是對小老闆的核心賣點**。
- **多通道**：CLI、Discord、Web（REST + WebSocket，前端 Next.js）。

## 3. 典型應用場景（接案/導入常見題型）

- 客服／FAQ 自動回覆（綁公司知識庫）。
- 社群內容產線（行銷定策略 → 內容角色產腳本/貼文）。
- 內部文件問答與整理。
- 報價／需求初判 → 轉系統分析 → 委派開發的半自動流程。

## 4. 劃 scope 的原則（SA / Sales 必讀）

1. **先看能不能用既有能力組出來**（多角色 + 知識庫 + 工具），再談客製。客製要明確標成本。
2. **每個案子要沉澱成可複用的 AgentOS 能力**，不接純人力外包（守則見 [[company-plan]]）。
3. **報價對齊單位經濟**（見 [[unit-economics]]）：把 LLM/harness 用量算進直接成本，別虧本接。
4. 明確界定：資料來源、整合點（是否要接客戶系統/MCP）、驗收標準、維運責任。

## 5. 邊界 / 目前不做

- 重平台型功能（YChatAgent 那條線）殿後，接案不要承諾。
- 沒有自動測試框架；交付靠手動驗證 + build type-check。
- 即時/大量並發、嚴格 SLA 的場景要先跟 DevOps + CFO 評估固定成本。
