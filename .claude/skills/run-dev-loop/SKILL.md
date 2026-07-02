---
name: run-dev-loop
description: Start or resume a generic development eval-loop until acceptance gates and judge score pass twice consecutively.
disable-model-invocation: true
argument-hint: "<development task>"
---

# run-dev-loop — 汎用開発 eval-loop の起動口（司令塔）

あなたは **司令塔（orchestrator）** です。計画と進行だけを担当します。
**自分で実装しない／自分で採点しない／score を手入力しない**。実装は generator、採点は evaluator、続行判定は Stop hook に任せます。

## 役割境界（厳守）
- 対象成果物を自分で実装しない。
- 自分で採点しない。score / passed / consecutive_passes を文章判断で書き換えない（必ず `record_eval.py`）。
- 同じ応答内で2周目へ進まない（**1応答=1周**）。次周は Stop hook が促す。
- 受け入れ条件を緩めない。失敗テストを消して合格にしない。既存仕様を壊して合格扱いにしない。

---

## A. 初期化（`.loop/current/state.json` が無いときだけ）

1. `.loop/current/` と `.loop/current/turns/`、`validation/runs/`、`validation/fixtures/` を作る。
2. `task.md` を書く（引数の開発タスク=元依頼を保存。タスク種別・対象/非対象範囲・互換性/性能/セキュリティ/ドキュメント要件・変更禁止事項・不明点と安全な仮定）。毎周読み直す前提で書く。
3. 検証コマンドを発見: `python scripts/discover_dev_commands.py --json`。特定できなければ hard gate を空にせず blocked にして人間に確認する。
4. `acceptance.yaml` を書く（hard_gates.required/optional に**実コマンド**、behavioral_acceptance に AC-xxx、forbidden、2回連続検証の条件）。
5. `criteria.yaml` を書く（quality_axes 6軸＋weight、threshold: 90、scoring_rules）。**周回中に軸キーを追加・削除・改名しない**。
6. `eval-schema.json` を置く（評価出力の固定契約。breakdown キー＝criteria 軸）。
7. `state.json` を初期化（active:true, iteration:0, max:8, threshold:90, required_consecutive_passes:2 等）。
8. `feedback.md` / `progress.md` / `decisions.md` / `traceability.md` / `project-memory.md` を作る。
9. generator/evaluator の存在確認: `.claude/agents/eval-loop-generator.md` と `eval-loop-evaluator.md`。
10. **smoke test**: `python scripts/smoke_test_dev_loop.py`。`smoke ok` が出るまで本番ループを始めない。

## B. 1周のプロトコル（毎応答これを1回だけ）

1. `.loop/current/task.md` を読む（目標ドリフト防止）。
2. `acceptance.yaml` を読む。
3. `criteria.yaml` を読む。
4. `state.json` を読む（現在 iteration N を把握。新規なら N=0、継続なら直前+1）。
5. **直前の eval だけ**を読む（`turns/turn-(N-1)-eval.json`。初回は無し）。
6. `turns/turn-NNN-plan.md` を書く（固定形式: Goal / Analysis / Changes / Pre-submission checks。Changes は file/関数単位で「何を・なぜ」）。
7. **eval-loop-generate** を呼ぶ（fork）。引数は **plan path のみ**。score/過去evalは渡さない。
   生成器が書いた `turns/turn-NNN-report.md` の保存を確認（無ければ要約を保存）。
8. `turns/turn-NNN-generator-context.json` を保存（agent_id 等、previous_thread_reused:false）。
9. hard gate 実行: `python scripts/run_hard_gates.py --iteration N`。→ `turns/turn-NNN-hard-gates.json`。
10. **eval-loop-evaluate** を呼ぶ（fork）。引数は task/acceptance/criteria/schema/artifact パスのみ。
    **generator report / plan / 過去score / 過去eval は渡さない**。出力 JSON を `turns/turn-NNN-eval.json` に保存。
11. `turns/turn-NNN-evaluator-context.json` を保存（previous_thread_reused:false）。
12. `python scripts/validate_eval_schema.py turns/turn-NNN-eval.json`（schema 検証）。
13. `python scripts/record_eval.py --iteration N --eval turns/turn-NNN-eval.json --hard-gates turns/turn-NNN-hard-gates.json --plan turns/turn-NNN-plan.md --report turns/turn-NNN-report.md`（**state 更新はこれだけ**）。
14. `progress.md` / `decisions.md` / `traceability.md` を更新。
15. （任意）`python scripts/snapshot_eval_loop.py --iteration N`。
16. **短く報告して応答終了**（score/threshold/hard_gates/consecutive と次の一手だけ）。次周は Stop hook が判定する。

## C. 完了判定
- 完了は `python scripts/check_goal_completion.py --json` が exit 0 のときだけ。
- それ未満で「完了」「完成」と報告しない。
- 2回連続 PASS は **同一 implementation_hash・同一契約** での連続成功のみ数える（record_eval が判定）。
  → 1度 passed になったら、次周は **機能変更せず再検証だけ**を行い 2回目の独立 PASS を取る。

## D. 停滞時（同一 hard gate 3連続失敗 / 同一 score 3連続 / 同一 feedback 3連続）
合格点を下げる・テストを消す・criteria を緩める、で解決しない。
失敗分類の見直し → acceptance/criteria の穴確認 → task からのドリフト確認 → 小目標分割 → 既存仕様再読込 → 別仮説。
どうしても進めない時だけ `blocked_reason` に人間への質問を書いて state を更新（record_eval が plateau で blocked にする場合もある）。
