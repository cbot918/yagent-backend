# Todo Workflow
接到一件待辦任務時怎麼做：讀 todo 的三層內文、往下指派、把產出收斂回成果清單。

## 何時用
被交派一件 eai-erp 待辦（通常訊息裡會帶 todo id），或使用者說「做 todo X」「這件事往下發」時。

## 這條工作流的全貌

```
Yale（人）  ─── 在 coding session 跟 Claude Code 一起把任務架構寫好 → todo.good
                                    │
                                    ▼  POST /api/dispatch { roleId: "yale-agent", text: "…todo id…" }
Yale（分身，就是你） ─── get_todo 讀 good → 拆解 → delegate_to_role 往下指派
                                    │
                                    ▼
                        engineer / qa / sa / marketing / …
                                    │
                                    ▼
                        create_outcome 收斂產出 → set_todo_status DONE
```

**你在中間那一層。** 你不是執行者，是分派者 —— 但你要負責「產出真的有被記下來」。

## 標準步驟

### 1. 先讀，不要猜
`get_todo <id>` 一定要先做。三層內文的意義：

| 層 | 意思 | 你該怎麼對待 |
|---|---|---|
| `raw` | 使用者原始丟出來的重點 | **意圖的真相**在這裡。跟 good 有落差時，落差本身要提出來 |
| `mid` | 補了一半，還沒收斂 | 代表**還不能派工**——缺的東西在這層通常寫成待答問題 |
| `good` | 完整任務架構 | 這才是可以照著派的版本 |

**成熟度不是 GOOD 就不要硬派。** 只有 `raw`／`mid` 表示細節還沒補齊，硬派下去就是叫人猜。
這種情況回報「這件事還沒架構完，缺的是 X／Y」，請本人先跟 Claude Code 談完 —— 或你自己問清楚後
用 `refine_todo` 寫回 `mid`（**不要**直接寫 `good`，那是談完才有的東西）。

### 2. 開工就標記
`set_todo_status <id> DOING`。沒標的話清單上看不出有人在動，會被重複派。

### 3. 拆解與指派
`good` 那份通常已經有步驟。你的工作是把它切成**自足的子任務**（對方看不到你的上下文），
每個用 `delegate_to_role` 交給對的成員：

- 寫程式 / 改 repo → `engineer`
- 測試 → `qa`；E2E 驗收 → `sa`
- 需求釐清、系統設計、產品決策 → `sa`
- 內容、文案、社群 → `content` / `marketing` / `brand`
- 報價、商務 → `cfo` / `sales`

⚠️ **會碰到程式碼的任務一定要帶「工作目錄：<絕對路徑>」**（查 `engineering/project-workspaces.md`）。
查不到就不要猜——回報該專案還沒登記路徑。這條跟 swpm-ops 是同一個規矩，理由一樣：
漏了它，coding agent 會跑在 yagent 自己的 workspace 裡改錯 repo。

⚠️ 純軟體專案的派工請走 **swpm 那條線**（`swpm-ops` skill：任務要同時寫進 ERP 又真的發下去）。
待辦這條線是給「不是軟體專案」的雜事用的——內容、對外文件、行政、研究。兩條線不要混。

### 4. 產出一定要收斂
成果不留下來，這條工作流就白跑了。任何一件事做完都要 `create_outcome`：

| 產出型態 | `kind` | 放哪 |
|---|---|---|
| 報告、分析、對外文件 | `REPORT` | 全文放 `body` |
| 影片、簡報、雲端檔案、repo | `LINK` / `FILE` | 網址放 `url`，`body` 寫摘要 |
| 其他（結論、決議） | `NOTE` | `body` |

**`todoId` 一定要帶**（除非真的不是從待辦長出來的）。沒帶就等於成果跟任務斷了關係，
之後問「上次那份報告是哪來的」就查不回去。

### 5. 收尾
`set_todo_status <id> DONE`。**順序是先 `create_outcome` 再標 DONE**——反過來的話，
中間出錯就會留下「已完成但沒有任何產出」的紀錄，那是最難查的狀態。

## 只是要記一筆
使用者只說「幫我記一下 X」時：`create_todo`，內容放 `raw`，**不要自己發揮成任務架構**。
raw 的定義就是「原始的、細節還沒補」——你替他補的東西不是他說的話。

## 別做的事
- 別在 `list_todos` 之後就假裝知道內容（它只回標題，這是刻意的）
- 別用 `save` 之類的整包覆寫去補細節——一律用 `refine_todo`，它結構上碰不到 `raw`
- 別把「我已經交給 engineer 了」當成完成。任務完成＝**成果清單裡有東西**
- 別自己動手做該派下去的事（除了讀文件這種近乎免費的動作）
