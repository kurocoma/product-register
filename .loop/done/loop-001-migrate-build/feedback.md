# feedback.md — 直近 eval の指摘（次周 plan へ変換する材料）

> このファイルは各周回後に「直前 eval.json の feedback / recommended_next_changes」を要約して上書き更新する。
> 司令塔は次周 plan の Analysis にここを反映する。generator/evaluator には渡さない。

## turn-002 eval（score 92 / threshold 90 → **PASS**, consecutive 1/2）
- 軸別: correctness95 / regression_safety97 / test_quality92 / maintainability91 / integration_fit85 / risk_control82。
- 充足: AC-001〜009 を実コードで確認。dry-run summary 修正・UIパネル一覧マウント・route.test・在庫honest化・レート制御(単体)・submit除去。既存無改変(AC-006)。
- 合格圏。残課題はすべて **recommended_next_changes（AC ではない）** で、本セッション(機能構築＋安全検証)のスコープ外＝live移行セッションへ繰越（DEC-011）:
  1. レート制御を route の runItems 呼び出しに実配線（delayMs/sleep は実装・テスト済みだが未配線）。
  2. forceDisplay="0" が既存公開商品を非表示化する副作用の明記/オプション化。
  3. route の commit 経路 e2e テスト、route 直下 helper の lib 抽出。

## turn-003 の方針 = **再検証のみ（機能変更しない）**
protocol C / DEC-011 に従い、turn-003 は **コードを一切変更せず**、同一 implementation_hash のまま hard gate 再実行＋新しい独立 evaluator で 2回目の PASS を取り、`check_goal_completion` で完了させる。
- generator は起動しない（変更なし）。
- 万一この再検証で evaluator が threshold 未満になった場合のみ、原因に応じて最小修正を検討（その時は streak リセット）。
