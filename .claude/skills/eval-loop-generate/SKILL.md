---
name: eval-loop-generate
description: Internal skill. Run one generator pass in a forked context from a specific turn plan.
context: fork
agent: eval-loop-generator
user-invocable: false
argument-hint: "<turn plan path>"
---

# eval-loop-generate（内部・generator 起動）

このスキルは **fork コンテキスト**で **eval-loop-generator** を1回だけ走らせる内部スキル。
ユーザーは直接呼ばない（`user-invocable: false`）。司令塔（run-dev-loop）からのみ呼ばれる。

## 渡してよいもの
- **turn plan path のみ**（例: `.loop/current/turns/turn-003-plan.md`）

## 渡してはいけないもの
- score / 過去 eval（turn-*-eval.json）/ 過去 feedback の点数
- 評価の合否情報

## generator への指示
1. `.loop/current/task.md` を読む（元依頼・禁止事項）。
2. 渡された plan path を読む。
3. plan の Changes を最小差分で実装する（plan 外の大規模変更・無関係リファクタ禁止）。
4. テストを削除・スキップ・緩和しない。実装そのものを直す。
5. plan の Pre-submission checks を自分で実行し、落ちたら直す。
6. `.loop/current/turns/turn-XXX-report.md` に実行コマンド・変更ファイル・未解決事項を書く。

司令塔へ返すのは **短い要約と保存パスだけ**（長いログは貼らない）。
