---
name: eval-loop-evaluate
description: Internal skill. Evaluate actual artifacts in a fresh forked context against fixed acceptance and criteria.
context: fork
agent: eval-loop-evaluator
user-invocable: false
argument-hint: "<task path> <acceptance path> <criteria path> <schema path> <artifact paths>"
---

# eval-loop-evaluate（内部・evaluator 起動）

このスキルは **fork コンテキスト**で **eval-loop-evaluator** を1回だけ走らせる内部スキル。
ユーザーは直接呼ばない（`user-invocable: false`）。司令塔（run-dev-loop）からのみ呼ばれる。
毎回まっさらな fork で起動し、前回の文脈を引き継がない（コンテキスト分離契約）。

## 渡してよいもの
- task path（`.loop/current/task.md`）
- acceptance path（`.loop/current/acceptance.yaml`）
- criteria path（`.loop/current/criteria.yaml`）
- schema path（`.loop/current/eval-schema.json`）
- artifact paths（評価対象の実ファイル群。例: `webui/app/api/migrate/...` 等）

## 渡してはいけないもの
- generator report（turn-*-report.md）
- plan（turn-*-plan.md）
- 過去 score / 過去 eval（turn-*-eval.json）
- 司令塔や generator の会話

## evaluator への指示
1. task / acceptance / criteria / schema を読む。
2. 実物を自分で開いて確認する。
3. 検証コマンド（test / typecheck / lint / build / pytest / run_hard_gates.py / git diff など read-only系）を自分で実行して証拠を取る。
4. criteria の各軸を 0..100 で絶対評価する。
5. **eval-schema.json に完全一致する JSON だけ**を出力する（JSON 以外を出力しない）。

## 出力
- `score == quality.overall`、`quality.breakdown` のキーは criteria 軸と完全一致。
- `evaluator_skill` は `"eval-loop-evaluator"` 固定。
- hard gate 失敗が見えているなら高得点で合格にしない。テストが通っていても設計・互換・保守・セキュリティ問題は減点。
- JSON 出力をそのまま司令塔が `turns/turn-XXX-eval.json` に保存する。
