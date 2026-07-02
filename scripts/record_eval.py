"""1周の結果を state.json に反映する唯一の更新器（state の頭脳）。

司令塔は score / passed / consecutive_passes を文章判断で直接書き換えてはならない。
必ずこのスクリプトを通す。passed はここで再計算する（evaluator の自己申告を信じない）。

完了の中核ルール:
- passed = schema_ok AND hard_gates_passed AND score >= threshold
- 2回連続PASS（required_consecutive_passes）は **同一 implementation_hash かつ同一契約
  (acceptance/criteria/schema/validator)** での連続成功のみ数える。実装または契約が
  変わったら consecutive_passes はリセットされる。

CLI:
  python scripts/record_eval.py --iteration N --eval <eval.json> --hard-gates <hg.json>
                                [--plan <plan>] [--report <report>] [--json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _loop_common import LOOP_DIR, REPO_ROOT, load_json, load_yaml, now_iso, save_json, sha256_file, sha256_text
from validate_eval_schema import validate, _criteria_axes

PLATEAU_LIMIT = 3


def _rel(p) -> str | None:
    if not p:
        return None
    try:
        return str(Path(p).resolve().relative_to(REPO_ROOT))
    except Exception:
        return str(p)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration", type=int, required=True)
    ap.add_argument("--eval", required=True)
    ap.add_argument("--hard-gates", required=True)
    ap.add_argument("--plan", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    state_path = LOOP_DIR / "state.json"
    state = load_json(state_path)
    crit = load_yaml(LOOP_DIR / "criteria.yaml") or {}
    threshold = int(crit.get("threshold", state.get("threshold", 90)))

    # --- evaluator JSON 検証 ---
    schema_errors: list[str] = []
    try:
        eval_obj = load_json(args.eval)
        schema_ok, schema_errors = validate(eval_obj, _criteria_axes())
    except Exception as e:
        eval_obj = {}
        schema_ok = False
        schema_errors = [f"eval json load error: {e}"]

    score = int(eval_obj.get("score", 0)) if schema_ok else 0

    # --- hard gate 結果 ---
    hg = load_json(args.hard_gates)
    hard_gates_passed = bool(hg.get("hard_gates_passed"))
    impl_hash = hg.get("implementation_hash")
    acceptance_hash = hg.get("acceptance_hash")
    criteria_hash = hg.get("criteria_hash")
    schema_hash = hg.get("schema_hash")
    validator_hash = hg.get("validator_hash")
    run_id = hg.get("run_id")
    failed_gates = sorted(g["id"] for g in hg.get("gates", []) if g["id"] in hg.get("required_gate_ids", []) and not g["pass"])

    task_path = LOOP_DIR / "task.md"
    task_hash = sha256_file(task_path) if task_path.exists() else None

    passed = bool(schema_ok and hard_gates_passed and score >= threshold)

    # --- 連続PASS判定 ---
    same_impl = impl_hash is not None and impl_hash == state.get("implementation_hash")
    contract_now = (acceptance_hash, criteria_hash, schema_hash, validator_hash)
    contract_prev = (
        state.get("acceptance_hash"),
        state.get("criteria_hash"),
        state.get("schema_hash"),
        state.get("validator_hash"),
    )
    same_contract = all(a is not None and a == b for a, b in zip(contract_now, contract_prev))

    required_consecutive = int(state.get("required_consecutive_passes", 2))
    if passed:
        if state.get("passed") and state.get("consecutive_passes", 0) >= 1 and same_impl and same_contract:
            consecutive = state.get("consecutive_passes", 0) + 1
        else:
            consecutive = 1
    else:
        consecutive = 0

    # --- 停滞判定 ---
    feedback_hash = sha256_text(eval_obj.get("feedback", "")) if schema_ok else None
    same_score = score == state.get("score")
    same_feedback = feedback_hash is not None and feedback_hash == state.get("last_feedback_hash")
    same_failed = failed_gates and failed_gates == state.get("last_failed_gates")
    if passed:
        plateau_count = 0
    elif same_impl and (same_score or same_feedback or same_failed):
        plateau_count = int(state.get("plateau_count", 0)) + 1
    else:
        plateau_count = 0

    # --- best 更新 ---
    best_score = state.get("best_score", 0)
    best_iteration = state.get("best_iteration")
    best_ref = state.get("best_ref")
    if score > best_score:
        best_score, best_iteration, best_ref = score, args.iteration, run_id

    # --- blocked / active / status ---
    blocked_reason = state.get("blocked_reason")
    if passed:
        blocked_reason = None
    elif plateau_count >= PLATEAU_LIMIT:
        blocked_reason = (
            f"plateau: {plateau_count}周 進展なし (score={score}, failed_gates={failed_gates}). "
            "失敗分類の見直し・小目標分割・既存仕様再読込・別仮説が必要。人間判断を仰ぐこと。"
        )

    if consecutive >= required_consecutive:
        active, status = False, "completed"
    elif blocked_reason:
        active, status = True, "blocked"
    elif args.iteration >= int(state.get("max", 8)):
        active, status = False, "max_reached"
    else:
        active, status = True, "running"

    state.update(
        {
            "active": active,
            "status": status,
            "iteration": args.iteration,
            "score": score,
            "threshold": threshold,
            "passed": passed,
            "schema_ok": schema_ok,
            "schema_errors": schema_errors,
            "hard_gates_passed": hard_gates_passed,
            "consecutive_passes": consecutive,
            "required_consecutive_passes": required_consecutive,
            "best_score": best_score,
            "best_iteration": best_iteration,
            "best_ref": best_ref,
            "last_plan_file": _rel(args.plan),
            "last_report_file": _rel(args.report),
            "last_eval_file": _rel(args.eval),
            "last_hard_gate_file": _rel(args.hard_gates),
            "task_hash": task_hash,
            "acceptance_hash": acceptance_hash,
            "criteria_hash": criteria_hash,
            "schema_hash": schema_hash,
            "validator_hash": validator_hash,
            "implementation_hash": impl_hash,
            "last_feedback_hash": feedback_hash,
            "last_failed_gates": failed_gates,
            "plateau_count": plateau_count,
            "blocked_reason": blocked_reason,
            "updated_at": now_iso(),
        }
    )
    save_json(state_path, state)

    summary = {
        "iteration": args.iteration,
        "score": score,
        "threshold": threshold,
        "schema_ok": schema_ok,
        "hard_gates_passed": hard_gates_passed,
        "passed": passed,
        "consecutive_passes": consecutive,
        "required_consecutive_passes": required_consecutive,
        "active": active,
        "status": status,
        "plateau_count": plateau_count,
        "blocked_reason": blocked_reason,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if schema_errors:
        print("schema_errors:", json.dumps(schema_errors, ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
