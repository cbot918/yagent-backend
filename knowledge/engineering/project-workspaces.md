# 專案 ↔ 本機工作目錄對照

ERP（swpm 模組）上的專案只有名字，沒有它在這台機器上的位置。coding harness 需要**絕對路徑**才動得到正確的 repo——`dispatch_coding_task` 的 `cwd` 不給就會落在 yagent 自己的 workspace，改到不相干的檔案。這份對照表就是補那一段。

## 先看 ERP，這裡是後備

`list_sw_projects` / `get_sw_project` 會帶出專案的 `repo` 欄位。**那個值可能是 git URL，也可能是本機絕對路徑**——欄位只有一個，兩種都放得進去。判斷方式很簡單：

- 以 `/` 開頭 → 就是本機絕對路徑，直接拿去當 `cwd`。
- 是 `github.com/...` 或空的 → **不能**拿去當 `cwd`，來查下面這張表。

## 對照表

| ERP 專案名 | 本機絕對路徑 | repo | 說明 |
|---|---|---|---|
| `form-platform` | `/Users/yale/Documents/coding/ElementAI/form-platform-server` | `github.com/cbot918/form-platform-server` | NestJS + Prisma + pnpm。分支 `feature/authentication`（scoped RBAC）。ERP 的 `repo` 欄位已存這個路徑。**🚨 見下方 e2e 警告。** |
| `eai-erp` / `eai-erp 權限系統` | `/Users/yale/Documents/coding/ElementAI/eai-erp` | `github.com/cbot918/eai-erp` | Spring Boot + MyBatis。**要 Java 17**，用 `./run.sh` 跑。ERP 的 `repo` 欄位存的是 git URL，路徑看這裡。 |
| `yagent` | `/Users/yale/Documents/coding/ElementAI/openclaw-proj/yagent` | — | 本系統自己。前端在 `web/`（Next.js，dev server 在 :3000）。 |
| `coscup-agent` | （未設定） | — | 需要時補上路徑再派工。 |

## 規則

1. **派工前先確定路徑。** ERP 的 `repo` 欄位不是絕對路徑就查這張表；表上也沒有的，不要猜——回報「這個專案沒有登記本機路徑」，請人補上。猜錯的代價是 coding agent 在錯的 repo 上改檔案。
2. **委派時把絕對路徑寫進任務描述**，格式固定：

   ```
   工作目錄：/Users/yale/Documents/coding/ElementAI/form-platform-server
   任務：<要做什麼>
   ```

3. 接到委派的角色（engineer / qa）**必須把那個路徑當成 `dispatch_coding_task` 的 `cwd`**，不要用預設值。
4. **盤點現況先自己讀，不要委派。** 每個 repo 根目錄多半有 `CLAUDE.md`（專案指南）與 `progress.md`／`HANDOFF.md`（實作進度）。用 `list_project_files` / `read_project_file` 直接讀這幾份即可——那幾乎免費。`dispatch_coding_task` 是拿來**執行指令、修改檔案**的，為了讀檔就啟動它，等於用最貴的資源做 `cat`。
5. **這張表是輔助，不是事實來源。** 它可能過期。真正的專案現況以 repo 裡的檔案為準；讀不到就說讀不到，不要拿這張表的摘要當成「我盤點過了」。
6. 路徑異動或新增專案就改這張表——它是 files-as-truth，改檔即生效，不用改程式。

## ⚠️ form-platform：e2e 測試會清空資料庫

`form-platform-server/test/auth.e2e-spec.ts` 的 `beforeEach` 對十幾張表下 `deleteMany({})`，**等於清空 `DATABASE_URL` 指向的整個資料庫**。而該專案 `.env` 的 `DATABASE_URL` 指向 **Zeabur 雲端**（`hnd1.clusters.zeabur.com`），不是本機可拋棄的 DB。

**現況（Yale 於 2026-07-24 確認）**：那個雲端 DB 目前是空的，所以現在跑不會有損失。

**但這是一個會過期的條件，不是解除。** 一旦有人開始寫入資料，同一條指令就會變成清空正式資料。因此：

- 要跑 e2e **一定要當場先確認 DB 現在還是空的**，不能引用這份文件的記載當作依據——這裡寫的是 2026-07-24 的狀態。
- 真正的解法是**獨立的 `TEST_DATABASE_URL`**（已列為專案的高優先任務）。在那之前，每次跑都是在賭。
- 單元測試（`pnpm test`）不碰 DB，隨時可以跑。
