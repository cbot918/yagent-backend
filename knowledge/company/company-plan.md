# ElementAI 公司詳細 Plan

> 對內溝通與對外簡介共用的公司計畫書。本文件同時是 AgentOS 裡 13 個角色 persona 的策略來源（精煉版注入每個角色的 system prompt，見 `roles/roles.json`）。

## 1. 願景與定位

- **一句話定位**：繁中優先，幫台灣中小企業／小老闆「用 AI agent 經營公司」。
- **護城河**：繁中在地化 + 中小企業 domain know-how + 內容社群累積的信任。
- **核心原則**：先用「AgentOS + 接案」驗證現金流與 PMF，**別太早 all-in 重的 YChatAgent**。

## 2. 三階段策略（一個漏斗 + 現金流引擎，互相餵養）

| 階段 | 時間 | 動作 | 在漏斗中的角色 | 變現 |
|---|---|---|---|---|
| 短期 | 0–6mo | 內容 / 社群 / 教學影片 | 漏斗頂：品牌信任、受眾累積、產品與接案的 lead 來源 | 業配 / 課程 / 訂閱 |
| 中期 | 6–18mo | 產品線 ① **AgentOS(Yagent)**：B 端小老闆的「公司經營自動化」，輕、先驗 PMF；② **YChatAgent**：類 Claude web（chat+code+workspace、自訂 sysprompt bot）平台，重、殿後 | 漏斗底：產品變現 | SaaS 訂閱 / 導入費 / 用量計費 |
| 長期 | 18mo+ | 中小企業 AI 導入顧問 / 接案 | 中間高毛利變現，且回饋產品真實需求（dogfooding / case study） | 專案費 / 顧問費 |

**三者如何互相餵養**：

```
內容/社群 ──帶受眾與信任──▶ 接案 lead + 產品試用
   ▲                              │
   │                              ▼
案例變內容 ◀──沉澱 domain know-how── 接案交付
   │                              │
   └──定義 AgentOS 功能 ◀─────────┘
        產品壓低交付成本、提高接案毛利
```

## 3. 產品線取捨

- **AgentOS（優先）**：賣點是「一個能跑虛擬公司角色（行銷／客服／文件／排程／工程）的 agent OS」。優先理由：輕、貼近接案需求、可快速驗 PMF。本 repo 的 cost/budget metering 子系統就是對小老闆的賣點 —— 可控成本。
- **YChatAgent（殿後）**：平台型、競爭大、開發重 → 中長期。待 AgentOS／接案帶來現金流與用戶洞察後再加碼。

## 4. 風險與守則

- 內容不能只是流量，要綁「轉接案／轉產品」的 CTA。
- 接案不要做成純人力外包；每個案子要沉澱成可複用的 AgentOS 能力。
- 成本（尤其 LLM／coding harness 用量）要從第一天就計量 → 對應 CFO 角色 + billing 子系統。

## 5. 虛擬公司角色（AgentOS personas）

13 個可實際執行／委派工作的 AI 員工，分四群：

- **經營層**：CEO、COO、CFO
- **產品 / 工程**：PM、Engineer、SA、QA、DevOps
- **市場 / 品牌 / 社群**：Marketing、Brand（品牌顧問）、Community（社群顧問）
- **業務 / 內容執行**：Sales/BD、Content Creator

每個角色的 persona 定義在 `roles/roles.json`；新增或調整成員＝改 JSON，無需改 code。
