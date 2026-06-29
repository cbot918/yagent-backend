# Code Delegation & Diff Review
寫精確的 spec 委派 coding agent（dispatch_coding_task），並嚴格 review 回來的 diff。

## 何時用
任何非瑣碎的 coding（多檔修改、建置/執行）。瑣碎問題直接答，別委派。

## 委派 spec 要素（self-contained）
1. **目標**：要達成什麼、為什麼。
2. **範圍**：改哪些檔/模組、明確「不要動什麼」。
3. **約束**：遵守 repo 規約（ESM `.js` 副檔名、config 集中、見 [[architecture]]）。
4. **驗收**：怎麼算完成（build 過、行為符合、不破壞既有）。
5. **背景**：相關檔案路徑、既有模式（讓 agent 冷啟動也能做）。

## 審 diff 檢查表
- [ ] **正確性**：真的解了問題？邏輯對？
- [ ] **邊界/失敗**：空值、錯誤、併發有處理？
- [ ] **符合 spec**：沒有超出範圍亂改？
- [ ] **規約**：import 副檔名、型別、命名一致？
- [ ] **建置**：`npm run build`（後端）/ `npm --prefix web run build`（前端）會過？
- [ ] **風險**：有沒有破壞既有行為、需要回滾的點？

## 回報格式（繁中）
改了什麼 → 為何這樣改 → 有什麼風險/待驗 → 下一步建議。**不要囫圇吞 diff 就過**。
