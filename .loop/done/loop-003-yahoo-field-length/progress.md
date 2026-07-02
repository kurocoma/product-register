# progress.md — eval-loop 進捗ログ（loop-003 Yahoo フィールド文字数整形）

| turn | iteration | goal(要約) | score | hard_gates | passed | consecutive | 次の一手 |
|---|---|---|---|---|---|---|---|
| (構築) | - | loop-002 完了→アーカイブ。ライブテストで文字数ブロッカー発見→loop-003 初期化(ベースライン201緑) | - | baseline=PASS | - | - | turn-000 を実行 |
| turn-000 | 0 | 全角切詰ヘルパ＋共有マッパー整形(name75/path20/expl500/headline30)実適用＋文字数検証統合 ＋テスト25 | **91** | PASS(lint/tsc/unit226/build) | **true** | **1/2** | turn-001: 機能変更せず**再検証**(2回目PASS→完了)。follow-up(executor経由のF04テスト/caption tag-aware切詰)は次セッション |
| turn-001 | 1 | 再検証のみ(機能変更なし・同一 hash 3f772f1e) | **91** | PASS(lint/tsc/unit226/build) | **true** | **2/2** | ✅ **COMPLETE**: check_goal_completion exit 0。status=completed |

## 完了（loop-003 Yahoo フィールド文字数整形）
- **2回連続 PASS（91→91, 同一 implementation_hash・同一契約）** で完了。AC-F01〜F06 充足。it-01002/01017/01033 をコードで解消。
- 次工程: ライブ再テスト `node tests/e2e_migrate.mjs --commit`（3件が Yahoo display=0 登録できるか実地検証）。

## メモ
- ベースライン: migrate 機能(PR #1, 201 tests)。lint0/tsc0/vitest201/build0。
- 前ループ: `.loop/done/loop-001-migrate-build`(92→91), `.loop/done/loop-002-migrate-hardening`(92→92)。
- 発見元: `node tests/e2e_migrate.mjs --commit` の it-01002/01017/01033。
