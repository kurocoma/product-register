# progress.md — eval-loop 進捗ログ（loop-004 Yahoo name 整形）

| turn | iteration | goal(要約) | score | hard_gates | passed | consecutive | 次の一手 |
|---|---|---|---|---|---|---|---|
| (構築) | - | loop-003 完了→アーカイブ。ライブ再テストで name(it-01017) 残存→loop-004 初期化(ベースライン226緑) | - | baseline=PASS | - | - | turn-000 を実行 |
| turn-000 | 0 | name の HTML除去(`<br>`→空白)＋文字数≤75かつ幅≤75 二重上限整形(キーワード保持)＋実データ風テスト | **93** | PASS(lint/tsc/unit243/build) | **true** | **1/2** | turn-001: 機能変更せず**再検証**(2回目PASS→完了)→ ライブ再テスト。follow-up(半角偏重name専用テスト)は次セッション |
| turn-001 | 1 | 再検証のみ(機能変更なし・同一 hash 0d3ee29a) | **92** | PASS(lint/tsc/unit243/build) | **true** | **2/2** | ✅ **COMPLETE**: check_goal_completion exit 0 |

## 完了（loop-004 Yahoo name 整形）
- **2回連続 PASS（93→92, 同一 hash）** で完了。AC-N01〜N05 充足。
- **ライブ再テスト③: name(it-01017) 実機解消を確認**（エラーが it-14091=画像紐づけ に変化）。次ブロッカー=画像。

## メモ
- ベースライン: lint0/tsc0/vitest226/build0。
- 前ループ: loop-001(92→91)/loop-002(92→92)/loop-003(91→91)。
- 発見元: loop-003 後の `e2e_migrate --commit` で path/explanation 解消・name のみ it-01017 失敗（楽天名の `<br>`＋キーワード詰め込み）。
