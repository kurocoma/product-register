# feedback.md — 直近 eval の指摘（次周 plan へ変換する材料）

> 各周回後に「直前 eval.json の feedback / recommended_next_changes」を要約して上書き更新する。generator/evaluator には渡さない。

## turn-000 eval（score 91 / threshold 90 → **PASS**, consecutive 1/2）
- 軸別: correctness92 / regression_safety93 / test_quality88 / maintainability90 / integration_fit92 / risk_control88。
- 充足: AC-F01〜F06。`buildYahooEditItemParams` が末尾で `fitYahooFieldLimits` を**実適用**（it-01002/01017/01033 解消）。`YahooConverter` 無改変・既存201緑・短い値不変。`validateEditItemParams` に文字数違反検知統合（shape互換）。
- 合格圏。残課題はすべて **recommended_next_changes（AC ではない）** で次セッション繰越:
  1. executor/migrate の dry-run を end-to-end で driving する F04 テスト（現状 validateEditItemParams 単体のみ）。
  2. caption(HTML可・5000) の raw 切詰が HTML タグを途中で割る可能性 → tag-aware 切詰。
  3. 半角判定が accented Latin 等を全角扱い（安全側だが over-trim）→ コメント明記/語境界切詰。
  4. validateEditItemParams.missing がフィールド名と人間向けメッセージ混在 → 構造化 {field,reason}。

## turn-001 の方針 = **再検証のみ（機能変更しない）**
protocol C に従い、turn-001 は **コードを一切変更せず**、同一 implementation_hash(3f772f1e) のまま hard gate 再実行＋新しい独立 evaluator で2回目の PASS を取り完了させる。generator 非起動。threshold 未満時のみ最小修正（streak リセット）。
