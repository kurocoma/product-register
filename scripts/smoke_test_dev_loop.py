"""eval-loop の配線を本番投入前に検証する smoke test（spec の18項目）。

各スクリプト/hook を一時ディレクトリへ隔離（EVAL_LOOP_* 環境変数）して実行し、
実 .loop/current を汚さずに進行制御・記録・スキーマ検証・コンテキスト分離を確認する。

  python scripts/smoke_test_dev_loop.py
全 PASS で最後に "smoke ok" を表示し exit 0。失敗時は exit 1。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

REAL_REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REAL_REPO / "scripts"
HOOKS = REAL_REPO / ".claude" / "hooks"
AGENTS = REAL_REPO / ".claude" / "agents"
SKILLS = REAL_REPO / ".claude" / "skills"

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  [{PASS if ok else FAIL}] {name}{(' -- ' + detail) if detail and not ok else ''}")


def _env(loop_dir: Path, root: Path) -> dict:
    e = dict(os.environ)
    e["EVAL_LOOP_REPO_ROOT"] = str(root)
    e["EVAL_LOOP_DIR"] = str(loop_dir)
    e["EVAL_LOOP_VALIDATION"] = str(root / "validation")
    e["PYTHONIOENCODING"] = "utf-8"
    return e


def run_script(name: str, args: list[str], loop_dir: Path, root: Path):
    p = subprocess.run(
        [sys.executable, str(SCRIPTS / name), *args],
        env=_env(loop_dir, root),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def run_hook(name: str, payload: dict):
    p = subprocess.run(
        [sys.executable, str(HOOKS / name)],
        input=json.dumps(payload).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def base_state(**over) -> dict:
    st = {
        "active": True, "status": "running", "iteration": 1, "max": 8,
        "score": 0, "threshold": 90, "passed": False, "hard_gates_passed": False,
        "consecutive_passes": 0, "required_consecutive_passes": 2,
        "best_score": 0, "best_iteration": None, "best_ref": None,
        "implementation_hash": None, "acceptance_hash": None, "criteria_hash": None,
        "schema_hash": None, "validator_hash": None,
        "last_stop_blocked_iteration": None, "plateau_count": 0, "blocked_reason": None,
        "last_feedback_hash": None, "last_failed_gates": [], "updated_at": None,
    }
    st.update(over)
    return st


def valid_eval(score: int) -> dict:
    return {
        "score": score,
        "quality": {"overall": score, "breakdown": {
            "correctness": score, "regression_safety": score, "test_quality": score,
            "maintainability": score, "integration_fit": score, "risk_control": score}},
        "hard_gate_findings": [{"id": "g1", "passed": True}],
        "evidence": ["file.ts:1 ok"],
        "feedback": "ok",
        "passed": score >= 90,
        "evaluator_skill": "eval-loop-evaluator",
        "evaluated_artifacts": ["src/x.ts"],
        "risks": [], "recommended_next_changes": [],
    }


def make_loop(root: Path, state: dict) -> Path:
    loop = root / ".loop" / "current"
    (loop / "turns").mkdir(parents=True, exist_ok=True)
    (root / ".loop").mkdir(exist_ok=True)
    (loop / "state.json").write_text(json.dumps(state), encoding="utf-8")
    (loop / "criteria.yaml").write_text(
        "quality_axes:\n"
        "  correctness:\n    weight: 30\n    description: a\n"
        "  regression_safety:\n    weight: 20\n    description: a\n"
        "  test_quality:\n    weight: 15\n    description: a\n"
        "  maintainability:\n    weight: 15\n    description: a\n"
        "  integration_fit:\n    weight: 10\n    description: a\n"
        "  risk_control:\n    weight: 10\n    description: a\n"
        "threshold: 90\n",
        encoding="utf-8",
    )
    noop = "python -c \"import sys; sys.exit(0)\""
    (loop / "acceptance.yaml").write_text(
        "task:\n  type: feature\n  target_paths:\n    - src/x.ts\n"
        "hard_gates:\n  required:\n    - id: g1\n      command: " + noop + "\n      cwd: .\n      pass_if: exit_code == 0\n",
        encoding="utf-8",
    )
    (loop / "eval-schema.json").write_text("{}", encoding="utf-8")
    (loop / "task.md").write_text("# task\n", encoding="utf-8")
    (root / "src").mkdir(exist_ok=True)
    (root / "src" / "x.ts").write_text("export const x = 1;\n", encoding="utf-8")
    return loop


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="evalloop_smoke_"))
    try:
        # 1. state なし → Stop hook は何もしない（allow）
        r = tmp / "c1"; (r / ".loop").mkdir(parents=True)
        code, out, _ = run_hook("eval_loop_stop.py", {"cwd": str(r)})
        check("1 no-state → allow stop", code == 0 and out.strip() == "", f"out={out!r}")

        # 2. active=false → allow
        r = tmp / "c2"; make_loop(r, base_state(active=False))
        code, out, _ = run_hook("eval_loop_stop.py", {"cwd": str(r)})
        check("2 active=false → allow stop", code == 0 and out.strip() == "", f"out={out!r}")

        # 3. 89点 threshold90（=未達/consec0）→ block
        r = tmp / "c3"; make_loop(r, base_state(score=89, consecutive_passes=0))
        code, out, _ = run_hook("eval_loop_stop.py", {"cwd": str(r)})
        check("3 below threshold → block", '"decision": "block"' in out, f"out={out!r}")

        # 4. 90点以上でも hard gate 失敗なら完了しない（record_eval: passed=false, consec=0）
        r = tmp / "c4"; loop = make_loop(r, base_state())
        (loop / "turns" / "e.json").write_text(json.dumps(valid_eval(95)), encoding="utf-8")
        (loop / "turns" / "hg.json").write_text(json.dumps({
            "run_id": "RUN-001-x", "hard_gates_passed": False, "gates": [{"id": "g1", "pass": False}],
            "required_gate_ids": ["g1"], "implementation_hash": "H", "acceptance_hash": "A",
            "criteria_hash": "C", "schema_hash": "S", "validator_hash": "V"}), encoding="utf-8")
        run_script("record_eval.py", ["--iteration", "1", "--eval", str(loop / "turns" / "e.json"),
                                      "--hard-gates", str(loop / "turns" / "hg.json")], loop, r)
        st = json.loads((loop / "state.json").read_text(encoding="utf-8"))
        check("4 score>=90 but hard gate fail → not passed", st["passed"] is False and st["consecutive_passes"] == 0,
              f"passed={st['passed']} consec={st['consecutive_passes']}")

        # 5. consecutive_passes >= required → allow stop（完了）
        r = tmp / "c5"; make_loop(r, base_state(consecutive_passes=2, passed=True, score=95, hard_gates_passed=True))
        code, out, _ = run_hook("eval_loop_stop.py", {"cwd": str(r)})
        check("5 consec>=required → allow stop", out.strip() == "", f"out={out!r}")

        # 6. 壊れた state.json を成功扱いしない
        r = tmp / "c6"; loop = make_loop(r, base_state())
        (loop / "state.json").write_text("{ broken json", encoding="utf-8")
        code, out, _ = run_hook("eval_loop_stop.py", {"cwd": str(r)})
        gc, gout, _ = run_script("check_goal_completion.py", ["--json"], loop, r)
        check("6 corrupt state → block once & not complete", '"decision": "block"' in out and gc == 2,
              f"hook={out!r} goal_exit={gc}")

        # 7. 同一 iteration で二重 block しない
        r = tmp / "c7"; make_loop(r, base_state(iteration=3, last_stop_blocked_iteration=3))
        code, out, _ = run_hook("eval_loop_stop.py", {"cwd": str(r)})
        check("7 same-iteration double-block guard → allow", out.strip() == "", f"out={out!r}")

        # 8. eval-schema 違反 → score 0
        r = tmp / "c8"; loop = make_loop(r, base_state())
        bad = valid_eval(95); del bad["risks"]  # 必須キー欠落
        (loop / "turns" / "e.json").write_text(json.dumps(bad), encoding="utf-8")
        (loop / "turns" / "hg.json").write_text(json.dumps({
            "run_id": "R", "hard_gates_passed": True, "gates": [{"id": "g1", "pass": True}],
            "required_gate_ids": ["g1"], "implementation_hash": "H", "acceptance_hash": "A",
            "criteria_hash": "C", "schema_hash": "S", "validator_hash": "V"}), encoding="utf-8")
        run_script("record_eval.py", ["--iteration", "1", "--eval", str(loop / "turns" / "e.json"),
                                      "--hard-gates", str(loop / "turns" / "hg.json")], loop, r)
        st = json.loads((loop / "state.json").read_text(encoding="utf-8"))
        check("8 schema violation → score 0 / not passed", st["score"] == 0 and st["passed"] is False,
              f"score={st['score']}")

        # 9. breakdown キー欠落を拒否
        sys.path.insert(0, str(SCRIPTS))
        import validate_eval_schema as V  # noqa: E402
        axes = ["correctness", "regression_safety", "test_quality", "maintainability", "integration_fit", "risk_control"]
        bad9 = valid_eval(90); del bad9["quality"]["breakdown"]["risk_control"]
        ok9, errs9 = V.validate(bad9, axes)
        check("9 breakdown missing axis → invalid", ok9 is False and any("breakdown" in e for e in errs9))

        # 10. required_consecutive_passes が 2
        r = tmp / "c10"; loop = make_loop(r, base_state())
        st = json.loads((loop / "state.json").read_text(encoding="utf-8"))
        check("10 required_consecutive_passes == 2", st["required_consecutive_passes"] == 2)

        # 11a. 失敗ターンで consecutive=0 / 11b. 実装変更で連続が途切れ 2 に到達しない
        r = tmp / "c11"; loop = make_loop(r, base_state(
            passed=True, consecutive_passes=1, score=95, hard_gates_passed=True,
            implementation_hash="H1", acceptance_hash="A", criteria_hash="C", schema_hash="S", validator_hash="V"))
        # 実装変更（H2）でも pass → streak リセット（2 には到達しない）
        (loop / "turns" / "e.json").write_text(json.dumps(valid_eval(95)), encoding="utf-8")
        (loop / "turns" / "hg.json").write_text(json.dumps({
            "run_id": "R2", "hard_gates_passed": True, "gates": [{"id": "g1", "pass": True}],
            "required_gate_ids": ["g1"], "implementation_hash": "H2", "acceptance_hash": "A",
            "criteria_hash": "C", "schema_hash": "S", "validator_hash": "V"}), encoding="utf-8")
        run_script("record_eval.py", ["--iteration", "2", "--eval", str(loop / "turns" / "e.json"),
                                      "--hard-gates", str(loop / "turns" / "hg.json")], loop, r)
        st = json.loads((loop / "state.json").read_text(encoding="utf-8"))
        impl_break = st["consecutive_passes"] == 1 and st["active"] is True
        # 続けて失敗ターン → 0 に戻る
        (loop / "turns" / "hg.json").write_text(json.dumps({
            "run_id": "R3", "hard_gates_passed": False, "gates": [{"id": "g1", "pass": False}],
            "required_gate_ids": ["g1"], "implementation_hash": "H2", "acceptance_hash": "A",
            "criteria_hash": "C", "schema_hash": "S", "validator_hash": "V"}), encoding="utf-8")
        run_script("record_eval.py", ["--iteration", "3", "--eval", str(loop / "turns" / "e.json"),
                                      "--hard-gates", str(loop / "turns" / "hg.json")], loop, r)
        st2 = json.loads((loop / "state.json").read_text(encoding="utf-8"))
        check("11 impl change breaks streak & fail resets to 0",
              impl_break and st2["consecutive_passes"] == 0, f"impl_break={impl_break} after_fail={st2['consecutive_passes']}")

        # 12. SubagentStart/Stop ログが残る
        r = tmp / "c12"; loop = make_loop(r, base_state())
        run_hook("eval_loop_subagent_log.py", {"cwd": str(r), "hook_event_name": "SubagentStart",
                                               "agent_id": "a1", "agent_type": "eval-loop-generator"})
        run_hook("eval_loop_subagent_log.py", {"cwd": str(r), "hook_event_name": "SubagentStop",
                                               "agent_id": "a1", "agent_type": "eval-loop-generator"})
        logp = loop / "subagents.log"
        lines = logp.read_text(encoding="utf-8").splitlines() if logp.exists() else []
        evs = {json.loads(ln)["hook_event"] for ln in lines}
        check("12 subagent start/stop logged", "SubagentStart" in evs and "SubagentStop" in evs, f"events={evs}")

        # 13. generate skill / generator agent に score・eval を渡さない契約
        gen_skill = (SKILLS / "eval-loop-generate" / "SKILL.md").read_text(encoding="utf-8")
        gen_agent = (AGENTS / "eval-loop-generator.md").read_text(encoding="utf-8")
        c13 = ("渡してはいけない" in gen_skill and "score" in gen_skill and "eval" in gen_skill.lower()
               and "score を探して" in gen_agent)
        check("13 generator context excludes score/eval (contract)", c13)

        # 14. evaluate skill / evaluator agent に report・plan・過去score・過去eval を渡さない契約
        ev_skill = (SKILLS / "eval-loop-evaluate" / "SKILL.md").read_text(encoding="utf-8")
        ev_agent = (AGENTS / "eval-loop-evaluator.md").read_text(encoding="utf-8")
        c14 = ("渡してはいけない" in ev_skill and "report" in ev_skill and "plan" in ev_skill
               and "過去 score" in ev_skill and "read-only" in ev_agent.lower())
        check("14 evaluator context excludes report/plan/score/eval (contract)", c14)

        # 15. run_hard_gates.py が JSON を出力（隔離・no-op ゲート）
        r = tmp / "c15"; loop = make_loop(r, base_state())
        code, out, err = run_script("run_hard_gates.py", ["--iteration", "1"], loop, r)
        try:
            j = json.loads(out)
            c15 = j.get("hard_gates_passed") is True and (loop / "turns" / "turn-001-hard-gates.json").exists()
        except Exception:
            c15 = False
        check("15 run_hard_gates emits JSON & file", c15, f"code={code} err={err[:120]}")

        # 16. check_goal_completion 未達で非0
        r = tmp / "c16"; loop = make_loop(r, base_state())
        gc, _, _ = run_script("check_goal_completion.py", ["--json"], loop, r)
        check("16 incomplete → exit 1", gc == 1, f"exit={gc}")

        # 17. 2回連続成功 + 2レポート一致 + 成果物 → exit 0
        r = tmp / "c17"; loop = make_loop(r, base_state())
        run_script("run_hard_gates.py", ["--iteration", "0"], loop, r)
        run_script("run_hard_gates.py", ["--iteration", "1"], loop, r)
        for it in (0, 1):
            (loop / "turns" / f"turn-{it:03d}-plan.md").write_text("# plan\n", encoding="utf-8")
            (loop / "turns" / f"turn-{it:03d}-report.md").write_text("# report\n", encoding="utf-8")
            (loop / "turns" / f"turn-{it:03d}-eval.json").write_text(json.dumps(valid_eval(95)), encoding="utf-8")
        done = base_state(active=False, status="completed", iteration=1, score=95, passed=True,
                          hard_gates_passed=True, consecutive_passes=2, blocked_reason=None)
        (loop / "state.json").write_text(json.dumps(done), encoding="utf-8")
        gc, gout, gerr = run_script("check_goal_completion.py", ["--json"], loop, r)
        check("17 two consecutive passes → exit 0", gc == 0, f"exit={gc} out={gout[-200:]}")

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    n_pass = sum(1 for _, ok, _ in results if ok)
    n_total = len(results)
    print(f"\n{n_pass}/{n_total} checks passed")
    if n_pass == n_total:
        print("smoke ok")
        return 0
    print("smoke FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
