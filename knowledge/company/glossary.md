# ElementAI 名詞表（Glossary）

> 跨角色共用的術語對齊。對外文案用語以 [[brand-voice]] 為準。

| 術語 | 定義 |
|---|---|
| **AgentOS** | 本 repo（yagent）對外的產品名。可跑「虛擬公司角色」的 agent OS，B 端小老闆的公司經營自動化。優先產品線。 |
| **YChatAgent** | 類 Claude web 的平台（chat + code + workspace、可自訂 system prompt 的 bot）。重、競爭大，**殿後**。 |
| **三階段漏斗** | 短期(0–6mo)內容/社群 → 中期(6–18mo)產品 → 長期(18mo+)顧問/接案，互相餵養的一個漏斗 + 現金流引擎。 |
| **漏斗頂 / 漏斗底** | 頂＝內容社群（累積信任與受眾、產生 lead）；底＝產品變現。 |
| **PMF** | Product–Market Fit。先用 AgentOS + 接案小規模驗證，別太早 all-in 重產品。 |
| **單位經濟 / unit economics** | 單一案子或單一用戶的收入 − 直接成本（含 LLM/coding harness 用量）。報價與接案都要看這個。 |
| **runway** | 現金可撐多久。CFO 關注。 |
| **coding harness** | 被委派執行 coding 的外部 agent（claude / opencode），透過 `dispatch_coding_task` 呼叫。是可抽換的子系統。 |
| **cost/budget metering** | AgentOS 內建的用量計費與預算上限子系統（`.usage/ledger.jsonl` + `billing.json`）。對小老闆是「可控成本」賣點。 |
| **dogfooding** | 自家接案／經營就用 AgentOS，邊用邊把需求沉澱回產品。 |
| **CTA** | Call to action。對外內容必帶（轉接案／轉產品／報名）。 |
| **lead** | 潛在客戶名單。內容社群帶 lead → Sales/SA 接手。 |
