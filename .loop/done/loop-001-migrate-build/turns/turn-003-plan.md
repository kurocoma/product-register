# turn-003 plan — 再検証（機能変更なし）

## Goal
turn-002 が PASS（score 92, consecutive 1/2）したため、protocol C / DEC-011 に従い **コードを一切変更せず**、同一 implementation_hash のまま **2回目の独立検証**を行い、`check_goal_completion` で完了させる。

## Analysis
- 直前 eval(turn-002): score 92 ≥ threshold 90, hard_gates_passed=true, passed=true, consecutive_passes=1。
- 完了条件: 同一 implementation_hash かつ同一契約で hard gate 緑 + evaluator score≥90 が **2回連続**（record_eval が判定）。
- よって turn-003 は **generator を起動しない**（変更なし）。hard gate を再実行（同一コード→同一 implementation_hash 28f26f71…）し、**新しい独立 evaluator**（まっさらな fork）で再採点する。
- 残課題（レート制御の実配線・forceDisplay 副作用・route commit e2e）は AC ではなく recommended_next_changes。本セッション(機能構築＋安全検証)スコープ外＝live移行セッションへ繰越（DEC-011）。本周では着手しない（収束のため）。

## Changes
- **なし**（再検証のみ）。`webui/**` は turn-002 から不変。

## 検証手順（司令塔が実施）
1. `python scripts/run_hard_gates.py --iteration 3`（同一コード→同一 implementation_hash・全ゲート緑を再確認）。
2. eval-loop-evaluator を fork 起動（task/acceptance/criteria/schema/artifact のみ）→ `turn-003-eval.json`。
3. `validate_eval_schema.py` → `record_eval.py --iteration 3`。
4. PASS かつ consecutive=2 なら `check_goal_completion.py --json`（exit 0 で完了）。

## 想定リスク
- 独立 evaluator は毎回まっさらな fork のため、同一コードでも採点が揺れて threshold 未満になりうる（2回連続要件が安定性を担保する所以）。その場合のみ原因に応じ最小修正を検討（streak リセット）。
