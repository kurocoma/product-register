# turn-001 plan（loop-004）— 再検証（機能変更なし）

## Goal
turn-000 が PASS（score 93, consecutive 1/2）したため、protocol C に従い **コードを一切変更せず**、同一 implementation_hash(0d3ee29a) のまま **2回目の独立検証**を行い、`check_goal_completion` で完了させる。

## Analysis
- 直前 eval: score 93 ≥ 90, hard_gates_passed=true, passed=true, consecutive=1。AC-N01〜N05 充足。
- 完了条件: 同一 implementation_hash かつ同一契約で hard gate 緑 + evaluator score≥90 が2回連続。
- turn-001 は generator 非起動。hard gate 再実行（同一 hash 0d3ee29a）＋新独立 evaluator で再採点。
- follow-up（半角偏重name専用テスト 等）は AC 外＝次セッション繰越。本周では着手しない。

## Changes
- **なし**（再検証のみ）。`webui/**` は turn-000 から不変。

## 検証手順（司令塔）
1. `run_hard_gates.py --iteration 1`（同一 hash・全緑）。
2. eval-loop-evaluator を fork → `turn-001-eval.json`。
3. `validate_eval_schema.py` → `record_eval.py --iteration 1`。
4. PASS かつ consecutive=2 なら `check_goal_completion.py --json`（exit 0 で完了）→ ライブ `e2e_migrate --commit` 再テスト。
