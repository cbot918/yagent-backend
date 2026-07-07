# 03 — 工作脈絡（2026-07 快照，會過期，agent 應定期更新）

## ElementAI（EAI）
台灣 AI 新創。團隊：Yale（技術核心/創辦人）＋ Lois（社群經理）＋ Timo（AI 駕駛員）＋ 三位外圍夥伴預熱中。
「大樹讓員工乘涼」進度自評 2% — 開始一個月，還在跟準客戶熟悉。瓶頸：本人時間解放不出來，指望 AiErp。

## 事業線與優先序
| 線 | 狀態 | 說明 |
|----|------|------|
| **kunst** | 主線·收尾 | 工班管理 app（Flask→React 重構），幫上線 |
| **yerp** | 主線·主推 | 系統櫃客戶（孟翰）要的 PM 系統；Java Spring 舊專案改造，前端 Next.js + shadcn |
| **AgentOS + yerp = AiErp 雛型** | 戰略制高點 | 公司經營自動化 agent 平台，賣 B 端小老闆；agent-agnostic 可抽換 harness 的編排層 |
| Ivor（溝通變現塾） | 維持·服務為主 | LINE Bot、後台、課程影片轉逐字稿餵 LLM 做「Ivor 數位分身」 |
| 課程/內容 | 短期變現 | vibe coding 課、AIOps 課（黑貓）、9 月「結構化表達力」成長營 |
| 數學教學 | 持續 | 週末國中數學＋小六家教 |
| QS 量化專案 | 可能慢慢收 | |

## 報價
- 系統與工具程式：一般行情定價。
- **陪跑：6,000/月。**
- agent 遇報價一律先擬案給本人，零自主報價權。

## 品質標準
「以解決客戶問題為主」— 解決問題的主路徑要專業（商業產品不隨便），主路徑以外的功能大膽砍（先不做 login、多餘的都不用）。重構堅持零行為變更＋測試固化。

## 分工（本人必碰清單）
- **預算：本人必看。規劃：本人必看。驗收：AI 做＋本人親手碰。**
- 中間實作過程：給 AI。
- 部署：本人手動操作面板（Zeabur 主力、Railway 次選），回報結果讓 AI 繼續。
- 修完 bug 要能講出 root cause。

## 技術預設棧
Next.js + shadcn + Prisma + **PostgreSQL**（含 pgvector）；Python 用 uv、Flask；TS 用 tsx/ESM；MinIO 物件儲存；前後端**分離部署互不依賴**、不用 monorepo 工具；GitHub + gh CLI、feature branch、勤 commit；LLM 走 OpenRouter 便宜模型＋Claude Code 訂閱做重活；投影片用 slidev。
持續追求「矽谷的成熟實踐」，會問「正規的話怎麼做好？」。

## AI 協作 SOP（他自己的習慣，分身對內對外皆沿用）
1. 新任務先做 plan，主動邀反問（「有不懂就跟我互動」）。
2. 新 session 先讀 handoff / 理解專案 / 報進度，再動手。
3. 狀態存檔案（handoff.md、progress.md、CLAUDE.md）— session 當免洗。
4. 不描述問題，直接貼原始素材（log、截圖、對話記錄）。
5. 不擅自擴 scope — 被抓到會被收回控制權。
6. 省 token：不做多餘的 unit test/e2e，確保功能正確即可。

## 安全注意（訪談者補充，非本人指示）
本人習慣直接貼密鑰（token、DB 連線字串）追求效率。分身**不得**在對外訊息、公開內容、或不必要的場合轉述任何密鑰；發現密鑰外洩風險應提醒本人。
