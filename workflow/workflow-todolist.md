# Workflow — 待辦清單（todolist）

> Yale 與 Claude Code 的固定協作流程：**待辦 → 一起架構 → 派給 yagent 的 Yale → 往下指派 → 成果清單**。
> 建立：2026-07-26。實作分支：`eai-erp` / `eai-erp-web` 的 `feature/todolist`、`yagent` 的 `feature/swpm-agent`。
>
> 這份是**流程的權威文件**。兩個執行面各有自己的手冊：
> - Claude Code 側（撈清單、問答、寫回、派工）：全域 skill `todo-workflow`（`~/.claude/skills/todo-workflow/SKILL.md`）
> - yagent 側（接到任務怎麼往下發）：`skills/todo-workflow/SKILL.md`

---

## 0. 一句話

待辦清單只記得住重點，**細節都在腦袋裡**。這條工作流就是把「腦袋裡的部分」用問答挖出來、
寫回同一筆待辦，然後才派工——並且保證產出會被記在成果清單裡，而不是散在各個對話。

---

## 1. 全貌

```
                  ┌─────────────────────────────────────────────┐
                  │  eai-erp  待辦清單 td_todo                   │
                  │    raw   原始重點（永不覆蓋）                │
                  │    mid   補了一半                            │
                  │    good  完整任務架構（可派工）              │
                  └─────────────────────────────────────────────┘
                        ▲ ②讀            │ ①列標題      ▲ ④寫回
                        │                ▼               │
  Yale ◄──③問答──►  Claude Code（全域 skill: todo-workflow）
                                         │
                                         │ ⑤ POST /api/dispatch
                                         ▼   { roleId: "yale-agent", text }
                            yagent · Yale 分身（skill: todo-workflow）
                                         │ ⑥ delegate_to_role
                                         ▼
                        engineer / qa / sa / content / marketing …
                                         │ ⑦ create_outcome
                                         ▼
                  ┌─────────────────────────────────────────────┐
                  │  eai-erp  成果清單 td_outcome                │
                  │    報告 / 連結 / 檔案 / 筆記 + 來源待辦      │
                  └─────────────────────────────────────────────┘
```

---

## 2. 七個步驟（誰做什麼）

| # | 誰 | 做什麼 | 技術面 |
|---|---|---|---|
| ① | Claude Code | Yale 說「現在有哪些 todolist」→ **只列標題**（含成熟度） | `POST /api/todo/todos/query` + `titlesOnly: true` |
| ② | Claude Code | Yale 說「我們來做 todo1」→ 讀出那筆的三層內文 | `POST /api/todo/todos/detail` |
| ③ | Claude Code ↔ Yale | **問答補細節**。兩人合起來當任務架構師 | 純對話，不動 DB |
| ④ | Claude Code | 把談出來的架構寫回 → `good`（沒談完就寫 `mid`） | `POST /api/todo/todos/refine` |
| ⑤ | Claude Code | 派工：把任務交給 yagent 的 Yale | `POST /api/dispatch`（yagent :3001） |
| ⑥ | yagent · Yale | 拆成自足子任務，`delegate_to_role` 往下發 | yagent 內部 |
| ⑦ | 執行者 / Yale | 產出寫進成果清單，然後把待辦標 DONE | `create_outcome` → `set_todo_status` |

**「統一派給 Yale，讓 Yale 再往下指派」** 是刻意的：Claude Code 不直接呼叫 engineer/qa。
理由是責任單一——要問「這件事現在誰在做」，只要問 Yale 那個 session，不用去追一堆平行的委派。

---

## 3. 三層內文（raw / mid / good）

這是整個工作流的核心資料設計。

| 層 | 誰寫 | 什麼時候 |
|---|---|---|
| `raw` | Yale（或 Claude Code 代記） | 一開始丟進來的重點。**之後永遠不覆蓋** |
| `mid` | Claude Code | 問答到一半發現還缺東西 → 記下已知的 + 待答問題 |
| `good` | Claude Code | 談完、可以照著派工的完整架構 |

- 「當前成熟度」是**衍生值**：`good` 有值→GOOD，否則 `mid` 有值→MID，否則 RAW。不落庫。
- **為什麼 raw 不能被覆蓋**：「原始那句話」跟「最後架構成什麼」的落差，是這張表最有價值的東西
  （同 `eai-erp/handoff.md` §11.7 的判例思路：原始提案 vs 最終核准的 delta）。
- 因此補細節一律走 **`/refine`** 而不是 `/save`：`save` 是整包覆寫，少帶一個欄位就把 `raw` 沖掉。
  `refine` 結構上碰不到 `raw`。

### `good` 該長什麼樣
問答結束後寫進 `good` 的東西，要能讓「沒參與這場對話的人」照著做：

```markdown
## 目標
一句話：做完之後世界有什麼不同。

## 範圍
- 要做：…
- 不做：…（這行常常比「要做」更重要）

## 步驟
1. …
2. …

## 交付物
具體到「一份什麼東西放在哪裡」——這會變成成果清單的一筆。

## 驗收標準
怎麼判斷做完了、做對了。

## 已知限制與前提
問答過程中確認過的約束（誰是對接人、什麼時候要、哪些資料還沒有）。
```

---

## 4. 端點與工具速查

### eai-erp（`:8090`，機器認證用 `X-Service-Token`）

| 端點 | 用途 |
|---|---|
| `POST /api/todo/todos/query` | 列表。`titlesOnly` / `statuses` / `maturity` / `keyword` / `tag` |
| `POST /api/todo/todos/detail?id=` | 單筆（三層內文） |
| `POST /api/todo/todos/create` | 新增（內容進 `raw`） |
| `POST /api/todo/todos/refine` | **只寫 `mid`/`good`（+標題），不動 `raw`** |
| `POST /api/todo/todos/save` | 整包覆寫（前端編輯表單用；agent 不要用） |
| `POST /api/todo/todos/setStatus` | OPEN / DOING / DONE |
| `POST /api/todo/todos/reorder` | 送完整的已排序 id 清單 |
| `POST /api/todo/todos/delete?id=` | 刪 |
| `POST /api/todo/outcomes/{query,create,save,reorder,delete}` | 成果清單（權限沿用 `todo.*`） |

**三組 service token，一組一個模組**（任一組外洩碰不到別的模組）：

| 模組 | eai-erp 端 | yagent 端 | 後端角色 |
|---|---|---|---|
| 報價 | `SERVICE_TOKEN` | `EAIERP_SERVICE_TOKEN` | `AGENT` |
| 軟體專案 | `SWPM_SERVICE_TOKEN` | `EAIERP_SWPM_TOKEN` | `AGENT_SWPM` |
| **待辦／成果** | **`TODO_SERVICE_TOKEN`** | **`EAIERP_TODO_TOKEN`** | **`AGENT_TODO`** |

### yagent 工具（`EAIERP_TODO_TOKEN` 有設才註冊）
`list_todos`／`get_todo`／`refine_todo`／`create_todo`／`set_todo_status`／`create_outcome`／`list_outcomes`

### 派工端點

```bash
curl -X POST http://localhost:3001/api/dispatch \
  -H 'content-type: application/json' \
  -d '{"roleId":"yale-agent","sessionKey":"todo:<todoId>","text":"<任務說明>"}'
# → 202 { ok: true, sessionKey, roleId }
```

- **回 202 就返回**，turn 在背景跑（一個 turn 可能好幾分鐘）。進度看 yagent web UI。
- `sessionKey` 建議帶 `todo:<todoId>`：同一件待辦的往來都在同一個 session，追得回去。
- ⚠️ **這個端點沒有認證**——跟 WS 的 `send` frame 一樣（本機服務，兩者權限相同）。
  但它確實代表「連得到這個 port 就能花模型預算」，要對外開的話 `/ws` 跟這裡**兩邊都要加認證**。

---

## 5. 只是要記一筆

Yale 有時只會說「幫我記一下 X」。那就只做一件事：`create_todo`，內容放 `raw`。
**不要自己補成任務架構**——raw 的定義就是「他原本說的話」。

---

## 6. 這條線刻意不做的事

- **不自動建成果**：待辦標 DONE 不會生出 outcome。成果要人（或 agent）主動寫，
  否則清單裡會塞滿空殼紀錄，比沒有更糟。
- **不做檔案上傳**：`FILE` 型態目前也是放 URL（雲端硬碟／repo 連結）。要真上傳就接 pm 模組的 `ObjectStore`。
- **不跟 swpm 混用**：軟體專案的派工走 `swpm-ops`（任務要同時寫進 ERP 又真的發下去）。
  待辦這條線是給「不是軟體專案」的事情用的。
- **不自動判斷成熟度該不該升級**：`good` 只有在「真的談完」時才寫。
  模型自己覺得夠了就寫 `good`，會讓成熟度失去意義。
