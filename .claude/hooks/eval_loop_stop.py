#!/usr/bin/env python
"""進行係（Stop hook）。AI ではなく state.json だけで「もう1周回すか/終わるか」を決める。

読むもの: active, iteration, max, score, threshold, hard_gates_passed,
          consecutive_passes, required_consecutive_passes,
          last_stop_blocked_iteration, plateau_count, blocked_reason, stop_hook_active
読まないもの: 成果物 / report / eval feedback本文 / plan本文 / ソースコード

終了を許可する条件:
  - state.json が無い / active=false
  - stop_hook_active=true（再入ガード）
  - consecutive_passes >= required_consecutive_passes（完了）
  - iteration >= max（打ち切り）
  - blocked_reason あり / plateau_count >= 上限（要人間判断）
  - 同一 iteration で既に1度 block 済み
それ以外は decision=block で次の1周を促す。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

PLATEAU_LIMIT = 3


def find_repo_root(start: Path) -> Path:
    for cand in [start, *start.parents]:
        if (cand / ".git").exists() or (cand / ".loop").exists():
            return cand
    return start


def allow_stop():
    # 何も出力しなければ停止を許可
    sys.exit(0)


def block(reason: str):
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    sys.exit(0)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    stop_hook_active = bool(payload.get("stop_hook_active"))
    cwd = Path(payload.get("cwd") or ".").resolve()
    root = find_repo_root(cwd)
    loop_dir = root / ".loop" / "current"
    state_path = loop_dir / "state.json"
    corrupt_marker = loop_dir / ".stop_corrupt_blocked"

    if not state_path.exists():
        allow_stop()

    # 破損時: 一度だけ block して修復を促す
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if corrupt_marker.exists():
            corrupt_marker.unlink()  # 復旧したのでマーカー解除
    except Exception:
        if corrupt_marker.exists():
            allow_stop()
        corrupt_marker.parent.mkdir(parents=True, exist_ok=True)
        corrupt_marker.write_text("blocked once for corruption\n", encoding="utf-8")
        block(
            "eval-loop: .loop/current/state.json が壊れています。"
            "バックアップ/直近 turn から state を復元してから再開してください。"
            "（この block は1回のみ。修復後に再実行で通常運転に戻ります）"
        )

    if stop_hook_active:
        allow_stop()
    if state.get("active") is not True:
        allow_stop()

    iteration = int(state.get("iteration", 0))
    max_it = int(state.get("max", 8))
    score = state.get("score", 0)
    threshold = state.get("threshold", 90)
    hgp = state.get("hard_gates_passed", False)
    consec = int(state.get("consecutive_passes", 0))
    req = int(state.get("required_consecutive_passes", 2))
    plateau = int(state.get("plateau_count", 0))
    blocked_reason = state.get("blocked_reason")
    last_blocked = state.get("last_stop_blocked_iteration")

    if consec >= req:
        allow_stop()
    if iteration >= max_it:
        allow_stop()
    if blocked_reason:
        allow_stop()
    if plateau >= PLATEAU_LIMIT:
        allow_stop()
    if last_blocked == iteration:
        # この iteration では既に1度 block 済み（多重 block 防止）
        allow_stop()

    # --- ここまで来たら未達: もう1周させる ---
    state["last_stop_blocked_iteration"] = iteration
    try:
        tmp = state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(state_path)
    except Exception:
        pass

    nxt = iteration + 1
    reason = f"""eval-loop 未達 — 次の1周(turn-{nxt:03d})を実行してください。

現在地: iteration={iteration} score={score}/{threshold} hard_gates_passed={hgp} consecutive_passes={consec}/{req} plateau={plateau}

次に読むファイル（この順で・直前evalのみ）:
1. .loop/current/task.md（目標ドリフト防止のため毎周読み直す）
2. .loop/current/acceptance.yaml
3. .loop/current/criteria.yaml
4. .loop/current/state.json
5. .loop/current/turns/turn-{iteration:03d}-eval.json（直前の eval だけ）

次に書く plan:
  .loop/current/turns/turn-{nxt:03d}-plan.md（Goal / Analysis / Changes / Pre-submission checks）

次に行う5手順:
1. 直前 eval の feedback と hard-gate 失敗を plan の Analysis に落とす
2. turn-{nxt:03d}-plan.md を書く
3. eval-loop-generate を fork で呼ぶ（plan path のみ渡す。score/過去evalは渡さない）
4. run_hard_gates.py --iteration {nxt} を実行 → eval-loop-evaluate を fork で呼ぶ
5. validate_eval_schema.py → record_eval.py --iteration {nxt} で state 更新し、応答終了（次周は再びこの hook が判定）

注意: 合格点を下げる/テストを消す/criteria を緩めることで通してはならない。実装を直すこと。"""
    block(reason)


if __name__ == "__main__":
    main()
