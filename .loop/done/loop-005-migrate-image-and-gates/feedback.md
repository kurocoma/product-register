# feedback.md — 直近 eval の指摘（次周 plan へ変換する材料）

## turn-000 eval（score 91 / threshold 90 → **PASS**, consecutive 1/2）
- 軸別: correctness93 / regression_safety95 / test_quality90 / maintainability87 / integration_fit90 / risk_control90。
- 充足: AC-A1〜A5・B1〜B4・C1〜C2。**A5 は effects 配列1箇所のみの順序是正＝正当**(緩和なし)。**A3 で upload先 lib/{sellerId} と editItem 参照先が一致＝it-14091 真の解消**。
- 合格圏。follow-up（AC外・次セッション）: (1) yahoo.ts の caption imgList/CSV item_image_urls の okimarumarket ハードコードを sellerId 化(yahoo.ts は非対象のため別途)。(2) executor dry-run に real validateEditItemParams を注入する end-to-end B4 テスト。(3) warnings を MigrationItemResult の専用フィールド化(現状 error に同梱)。(4) image_count=0 だが image_url_1 ありの全失敗ガード源を route と統一。

## turn-001 の方針 = **再検証のみ（機能変更しない）**
protocol C に従い turn-001 は **コードを一切変更せず**、同一 implementation_hash(453cc70e) のまま hard gate 再実行＋新独立 evaluator で2回目 PASS→完了。generator 非起動。完了後にライブ `e2e_migrate --commit` 再実行で it-14091 実機解消を確認。
