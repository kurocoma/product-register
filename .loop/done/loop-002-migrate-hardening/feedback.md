# feedback.md — 直近 eval の指摘（次周 plan へ変換する材料）

> 各周回後に「直前 eval.json の feedback / recommended_next_changes」を要約して上書き更新する。
> 司令塔は次周 plan の Analysis にここを反映する。generator/evaluator には渡さない。

## turn-000 eval（score 92 / threshold 90 → **PASS**, consecutive 1/2）
- 軸別: correctness94 / regression_safety93 / test_quality92 / maintainability92 / integration_fit90 / risk_control88。
- 充足: AC-H01(delayMs配線・既定300・body可・不正丸め) / AC-H02(既存display保持・新規'0') / AC-H03(continueOnError=false で skipped emit・true不変) / AC-H04(>200で400) / AC-H05/H06(既存189+新規=201緑・既存無改変)。
- 合格圏。残課題はすべて **recommended_next_changes（AC ではない・より深い堅牢化）** で次セッション繰越:
  1. 大量入力のチャンク/バッチ化＋再開可能進捗（200件×delayMs300≈60s で serverless timeout / 部分commit リスク。cap は緩和のみ）。
  2. commit の冪等性/チェックポイント（途中失敗の安全な再試行）。
  3. item 内 getItem フォールバック連鎖（getItem→SKU検索→getItem）のレート制御。
  4. MigratePanel に delayMs/preserveExistingDisplay を露出（運用調整）。
  5. bulk(既存保持) と単品 register/yahoo(更新時'0') の display 既定差異の明文化/整合。

## turn-001 の方針 = **再検証のみ（機能変更しない）**
protocol C に従い、turn-001 は **コードを一切変更せず**、同一 implementation_hash(7302c56b) のまま hard gate 再実行＋新しい独立 evaluator で2回目の PASS を取り `check_goal_completion` で完了させる。generator は起動しない。万一 threshold 未満になった場合のみ最小修正を検討（streak リセット）。
