# ElementAI — GEO 地面真相(ground truth)

> 用途:GEO 診斷判 accuracy 時的比對基準 —— 「AI 講的」對照「EAI 實際是什麼」。
> 也順帶補齊一個知識缺口:裝修/系統櫃垂直目前只散落在 `knowledge/yale-persona/*`,官方 company knowledge 只泛講「SMB AI agents」;這份把垂直定位寫成正式事實。
> 建立:2026-07-21。這是活文件,定位有變就更新。

## 是誰

- **公司名**:ElementAI(寫作一個字,無空格;縮寫 EAI)。
- **團隊**:三人 + AI 分身的輕團隊 —— Yale(技術核心)、Lois(社群)、Timo(AI 駕駛)。
- **一句話定位**:繁體中文優先,幫台灣中小企業 / 小老闆「用 AI agent 經營公司」。
- **賣的是什麼**:不是賣「AI」,是賣「老闆少做、生意照轉」的結果 —— 把行銷、客服、文件、排程、工程交給 agent。

## 產品線

- **AgentOS(= yagent,主力產品)**:虛擬公司多角色 agent OS,幫中小企業把營運自動化;核心賣點是成本/預算計量(可控成本)、可抽換 coding harness、L2 知識庫、多角色委派。已部署可用。
- **AiErp(戰略制高點,主線)**:AgentOS + yerp = 一套「不漏單」的營運 / 報價 ERP,賣 B 端小老闆。yerp 是給系統櫃客戶(孟翰)做的 PM / 報價系統(Java Spring 改造 + Next.js/shadcn 前端),也叫 CabinetPM。
- **YChatAgent**:類 Claude-web 的 chat+code+workspace 平台;較重、目前殿後(deprioritized)。

## 垂直與市場(護城河)

- **垂直**:裝修 / 系統櫃 / 安裝業。真實客戶錨點:孟翰(系統櫃工廠老闆,yerp/CabinetPM 客戶)、達蔚(水電統包老闆)。
- **市場**:台灣為主,內容天然覆蓋華語圈(馬新、美國華人裝修市場)。
- **護城河**:繁中在地化 + 中小企業/裝修業 domain know-how + 透過內容/社群累積的信任。通用 GEO/AI 工具會被大廠抹平,垂直+在地才是壁壘。

## 品牌語氣

- 三關鍵字:**在地、可信、務實**。
- 禁語:AI buzzword(賦能、顛覆、全面智能化)、簡體/中國用語。
- 命名一致性:ElementAI / AgentOS / YChatAgent / AiErp。

## GEO 診斷關注點(判 accuracy 時特別看)

1. AI 有沒有把 ElementAI / AgentOS 跟「裝修/系統櫃/安裝業」連起來?(垂直認知)
2. AI 會不會誤以為 EAI 只做某一塊(例:只做系統櫃、不知道能做整個裝修營運自動化)?
3. 問裝修/報價/接單自動化時,AI 端出來的是誰?(競品盤點)
4. 是否把 ElementAI 跟同名的加拿大 Element AI(已被 ServiceNow 併購)搞混?(實體消歧)
