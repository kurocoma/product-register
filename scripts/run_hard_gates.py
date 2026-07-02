"""acceptance.yaml に定義された hard gate（機械判定の検証コマンド）を実行し、結果を JSON 保存する。

保存先:
  .loop/current/turns/turn-XXX-hard-gates.json
  validation/runs/RUN-XXX/report.json  （+ 各ゲートの全文ログ <gate>.log）

LLM は介在しない。exit_code のみで pass/fail を判定する。
required が全て pass のとき hard_gates_passed=true。

CLI:
  python scripts/run_hard_gates.py --iteration N [--gates required|all]
                                   [--only id1,id2] [--skip id1,id2]
                                   [--timeout 900]
終了コード: 0=required全pass, 1=required失敗あり, 2=設定不能(コマンド未特定/壊れ)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from _loop_common import (
    LOOP_DIR,
    REPO_ROOT,
    TURNS_DIR,
    VALIDATION_DIR,
    load_yaml,
    now_iso,
    save_json,
    sha256_file,
    sha256_paths,
)

VALIDATOR_FILES = [
    "scripts/run_hard_gates.py",
    "scripts/validate_eval_schema.py",
    "scripts/record_eval.py",
    "scripts/check_goal_completion.py",
    "scripts/_loop_common.py",
]


def _summary(text: str, max_lines: int = 40) -> str:
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text.strip()
    head = lines[:5]
    tail = lines[-(max_lines - 5):]
    return "\n".join(head + [f"... ({len(lines) - max_lines} lines omitted) ..."] + tail).strip()


def _run_one(gate: dict, run_dir: Path, timeout: int) -> dict:
    cmd = gate["command"]
    cwd = REPO_ROOT / (gate.get("cwd") or ".")
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        exit_code = proc.returncode
        out = proc.stdout.decode("utf-8", errors="replace")
        err = proc.stderr.decode("utf-8", errors="replace")
        timed_out = False
    except subprocess.TimeoutExpired as e:
        exit_code = 124
        out = (e.stdout or b"").decode("utf-8", errors="replace") if e.stdout else ""
        err = (e.stderr or b"").decode("utf-8", errors="replace") if e.stderr else ""
        err += f"\n[run_hard_gates] TIMEOUT after {timeout}s"
        timed_out = True
    duration = round(time.time() - started, 2)

    gid = gate["id"]
    (run_dir / f"{gid}.log").write_text(
        f"$ {cmd}\n(cwd={cwd})\n--- STDOUT ---\n{out}\n--- STDERR ---\n{err}\n",
        encoding="utf-8",
    )
    return {
        "id": gid,
        "command": cmd,
        "cwd": gate.get("cwd") or ".",
        "exit_code": exit_code,
        "pass": exit_code == 0,
        "timed_out": timed_out,
        "duration_sec": duration,
        "stdout_summary": _summary(out),
        "stderr_summary": _summary(err),
    }


def _git(args: list[str]) -> str:
    try:
        r = subprocess.run(
            ["git", *args], cwd=str(REPO_ROOT), stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        return r.stdout.decode("utf-8", errors="replace")
    except Exception:
        return ""


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration", type=int, required=True)
    ap.add_argument("--gates", choices=["required", "all"], default="all")
    ap.add_argument("--only", default="")
    ap.add_argument("--skip", default="")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args(argv)

    acc_path = LOOP_DIR / "acceptance.yaml"
    crit_path = LOOP_DIR / "criteria.yaml"
    schema_path = LOOP_DIR / "eval-schema.json"
    if not acc_path.exists():
        print("acceptance.yaml not found — 検証コマンド未特定 (blocked)", file=sys.stderr)
        return 2

    acc = load_yaml(acc_path)
    hg = (acc or {}).get("hard_gates") or {}
    required = list(hg.get("required") or [])
    optional = list(hg.get("optional") or [])

    if not required:
        print("hard_gates.required が空 — 検証コマンド未特定 (blocked)", file=sys.stderr)
        return 2

    only = {s for s in args.only.split(",") if s}
    skip = {s for s in args.skip.split(",") if s}

    selected_required = [g for g in required if (not only or g["id"] in only) and g["id"] not in skip]
    selected_optional = (
        [] if args.gates == "required" else [g for g in optional if (not only or g["id"] in only) and g["id"] not in skip]
    )

    run_id = f"RUN-{args.iteration:03d}-{time.strftime('%H%M%S')}"
    run_dir = VALIDATION_DIR / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    started_at = now_iso()
    req_results = [_run_one(g, run_dir, args.timeout) for g in selected_required]
    opt_results = [_run_one(g, run_dir, args.timeout) for g in selected_optional]
    finished_at = now_iso()

    required_passed = all(r["pass"] for r in req_results) and len(req_results) > 0
    optional_passed = all(r["pass"] for r in opt_results)

    target_paths = ((acc or {}).get("task") or {}).get("target_paths") or []
    impl_hash, impl_files = sha256_paths(REPO_ROOT, target_paths)

    validator_concat = "".join(
        sha256_file(REPO_ROOT / f) for f in VALIDATOR_FILES if (REPO_ROOT / f).exists()
    )
    from _loop_common import sha256_text

    changed = [ln[3:] for ln in _git(["status", "--porcelain"]).splitlines() if ln.strip()]

    report = {
        "run_id": run_id,
        "iteration": args.iteration,
        "started_at": started_at,
        "finished_at": finished_at,
        "gates": req_results + opt_results,
        "required_gate_ids": [g["id"] for g in selected_required],
        "optional_gate_ids": [g["id"] for g in selected_optional],
        "required_passed": required_passed,
        "optional_passed": optional_passed,
        "hard_gates_passed": required_passed,
        "implementation_hash": impl_hash,
        "implementation_files": impl_files,
        "acceptance_hash": sha256_file(acc_path),
        "criteria_hash": sha256_file(crit_path) if crit_path.exists() else None,
        "schema_hash": sha256_file(schema_path) if schema_path.exists() else None,
        "validator_hash": sha256_text(validator_concat),
        "changed_files": changed,
        "cache_used": False,
        "manual_changes_detected": False,
    }

    TURNS_DIR.mkdir(parents=True, exist_ok=True)
    turn_path = TURNS_DIR / f"turn-{args.iteration:03d}-hard-gates.json"
    save_json(turn_path, report)
    save_json(run_dir / "report.json", report)

    print(
        json.dumps(
            {
                "run_id": run_id,
                "hard_gates_passed": required_passed,
                "required": [{"id": r["id"], "pass": r["pass"], "exit_code": r["exit_code"]} for r in req_results],
                "optional": [{"id": r["id"], "pass": r["pass"], "exit_code": r["exit_code"]} for r in opt_results],
                "turn_file": str(turn_path.relative_to(REPO_ROOT)),
                "report": str((run_dir / "report.json").relative_to(REPO_ROOT)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if required_passed else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
