"""このコマンド単体で「開発タスクの最終完了」を判定する。

  python scripts/check_goal_completion.py --json

終了コード:
  0 = 完了
  1 = 未完了
  2 = state 破損 / 検証不能
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from _loop_common import LOOP_DIR, TURNS_DIR, VALIDATION_DIR, load_json


def _collect_reports() -> list[dict]:
    runs = VALIDATION_DIR / "runs"
    out = []
    if not runs.exists():
        return out
    for rep in sorted(runs.glob("*/report.json")):
        try:
            out.append(load_json(rep))
        except Exception:
            pass
    out.sort(key=lambda r: r.get("run_id", ""))
    return out


def evaluate():
    state_path = LOOP_DIR / "state.json"
    if not state_path.exists():
        return 2, [("state.json", False, "state.json が無い")], {}
    try:
        st = load_json(state_path)
    except Exception as e:
        return 2, [("state.json", False, f"破損: {e}")], {}

    checks: list[tuple[str, bool, str]] = []

    def chk(name, cond, detail=""):
        checks.append((name, bool(cond), detail))

    req_consec = int(st.get("required_consecutive_passes", 2))
    chk("active=false", st.get("active") is False, str(st.get("active")))
    chk("hard_gates_passed", st.get("hard_gates_passed") is True)
    chk("score>=threshold", int(st.get("score", 0)) >= int(st.get("threshold", 90)),
        f"{st.get('score')}/{st.get('threshold')}")
    chk("passed", st.get("passed") is True)
    chk("consecutive>=required", int(st.get("consecutive_passes", 0)) >= req_consec,
        f"{st.get('consecutive_passes')}/{req_consec}")
    chk("required_consecutive==2", req_consec == 2)
    chk("no_blocker", not st.get("blocked_reason"), str(st.get("blocked_reason")))

    # 2回分の独立検証レポート + ハッシュ一致
    passing = [r for r in _collect_reports() if r.get("hard_gates_passed")]
    chk("two_passing_reports", len(passing) >= 2, f"passing={len(passing)}")
    if len(passing) >= 2:
        a, b = passing[-2], passing[-1]
        for key in ("implementation_hash", "acceptance_hash", "criteria_hash", "validator_hash"):
            chk(f"{key}_same_2runs", a.get(key) is not None and a.get(key) == b.get(key))

    # turn 成果物の保存
    it = int(st.get("iteration", 0))
    for suffix in ("plan.md", "report.md", "eval.json", "hard-gates.json"):
        f = TURNS_DIR / f"turn-{it:03d}-{suffix}"
        chk(f"artifact:{suffix}", f.exists(), str(f.relative_to(LOOP_DIR.parent.parent)) if f.exists() else "missing")

    complete = all(ok for _, ok, _ in checks)
    return (0 if complete else 1), checks, st


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    code, checks, st = evaluate()
    if as_json:
        print(
            json.dumps(
                {
                    "complete": code == 0,
                    "exit_code": code,
                    "status": st.get("status"),
                    "iteration": st.get("iteration"),
                    "score": st.get("score"),
                    "consecutive_passes": st.get("consecutive_passes"),
                    "checks": [{"name": n, "ok": ok, "detail": d} for n, ok, d in checks],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        label = {0: "COMPLETE", 1: "INCOMPLETE", 2: "UNVERIFIABLE"}[code]
        print(label)
        for n, ok, d in checks:
            print(f"  [{'x' if ok else ' '}] {n}{(' — ' + d) if d else ''}")
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
