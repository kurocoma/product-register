# progress.md — eval-loop 進捗ログ（loop-005 Bundle A+B）

| turn | iteration | goal(要約) | score | hard_gates | passed | consecutive | 次の一手 |
|---|---|---|---|---|---|---|---|
| (構築) | - | loop-004 完了→アーカイブ。監査で残12件→Bundle A+B を loop-005 初期化(ベースライン243緑) | - | baseline=PASS | - | - | turn-000 を実行 |
| turn-000 | 0 | Bundle A(it-14091順序是正/uploaded駆動画像/sellerId動的化/warnings/リトライ/A5テスト是正)＋B(値域ゲート) | **91** | PASS(lint/tsc/unit261/build) | **true** | **1/2** | turn-001: 機能変更せず**再検証**(2回目PASS→完了)→ ライブ再テスト。evaluator確認: A5正当・A3でupload先と参照先一致 |
| turn-001 | 1 | 再検証のみ(機能変更なし・同一 hash 453cc70e) | **91** | PASS(lint/tsc/unit261/build) | **true** | **2/2** | ✅ **COMPLETE**: check_goal_completion exit 0 |

## 完了（loop-005 Bundle A+B）＋ 🎉ライブ成功
- **2回連続 PASS（91→91）** で完了。
- **ライブ commit④: 3/3 ok（r0101-1/r1101-1/r113-1 が Yahoo display=0 登録成功）。it-14091 実機解消。** 全ライブブロッカー(it-01002/01033/01017/14091)踏破。
- 残: r0101-1 に **editItem 警告 it-00002/it-00004（caption/sp_additional のタグ閉じ）** = 登録は成功・警告のみ。description HTML のタグ閉じ整形が品質 follow-up。

## メモ
- ベースライン: lint0/tsc0/vitest243/build0。
- 前ループ: loop-001..004 完了。文字数系ブロッカー実機解消済み。
- 監査: docs/しまのや/migrate-audit-2026-06-30.md（残12件・4束）。本ループは Bundle A(it-14091)+B(値域ゲート)。
