# progress.md — eval-loop 進捗ログ（loop-002 本番ハードニング）

| turn | iteration | goal(要約) | score | hard_gates | passed | consecutive | 次の一手 |
|---|---|---|---|---|---|---|---|
| (構築) | - | loop-001(機能構築)完了→アーカイブ。loop-002 初期化(ベースライン189緑) | - | baseline=PASS | - | - | turn-000 を実行 |
| turn-000 | 0 | AC-H01 レート制御配線(delayMs300) / AC-H02 既存display保持 / AC-H03 skipped emit / AC-H04 上限200ガード ＋テスト3本 | **92** | PASS(lint/tsc/unit201/build) | **true** | **1/2** | turn-001: 機能変更せず**再検証**(2回目PASS→完了)。深掘り(チャンク化/冪等性/UI露出)は次セッション繰越 |
| turn-001 | 1 | 再検証のみ(機能変更なし・同一 hash 7302c56b) | **92** | PASS(lint/tsc/unit201/build) | **true** | **2/2** | ✅ **COMPLETE**: check_goal_completion exit 0(全チェックOK)。status=completed |

## 完了（loop-002 本番ハードニング）
- **2回連続 PASS（92→92, 同一 implementation_hash・同一契約）** で完了。AC-H01〜H06 充足（レート制御配線・既存display保持・skipped honest化・大量入力ガード・後方互換・テスト）。
- 次セッション繰越（より深い堅牢化・DEC-205）: サーバ側バッチ/チャンク化・429/5xx バックオフ再試行・commit 冪等性/再開・item内getItem連鎖のレート制御・MAX_ITEMS/delayMs の定数化・MigratePanel への露出。

## メモ
- ベースライン: loop-001 完了時点の実装（migrate lib + route + MigratePanel）。lint0/tsc0/vitest189/build0。
- 前ループ記録: `.loop/done/loop-001-migrate-build/`（score 92→91 の2回連続PASSで完了）。
