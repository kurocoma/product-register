# feedback.md — 直近 eval の指摘（次周 plan へ変換する材料）

## turn-000 eval（score 93 / threshold 90 → **PASS**, consecutive 1/2）
- 軸別: correctness95 / regression_safety95 / test_quality91 / maintainability92 / integration_fit93 / risk_control90。
- 充足: AC-N01〜N05。name の HTML除去(`<br>`→空白)＋文字数≤75かつ幅≤75 二重上限。evaluator が実データ REAL_NAME で実証（106字/91全角→75字/63.5全角・HTML無・本来商品名先頭保持）。既存226無改変・item-mapper-fit('あ'×100→75)緑・YahooConverter不変。
- 合格圏。follow-up（AC外・次セッション）: 半角偏重name(fullWidthLen≤75 だが文字数>75)の専用回帰テスト / サロゲート・結合文字の統合経路テスト / Yahoo実カウントのライブ最終確認をノート化。

## turn-001 の方針 = **再検証のみ（機能変更しない）**
protocol C に従い turn-001 は **コードを一切変更せず**、同一 implementation_hash(0d3ee29a) のまま hard gate 再実行＋新独立 evaluator で2回目 PASS→完了。generator 非起動。完了後にライブ `e2e_migrate --commit` 再実行で it-01017 実機解消を確認。
