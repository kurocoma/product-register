"""リポジトリから検証コマンド（test/lint/typecheck/build）を発見して JSON で提案する。

run-dev-loop の初期化時に hard gate を確定するための補助。コマンドが特定できない場合は
空にせず "unresolved" を立てて呼び出し側に blocked を促す。

  python scripts/discover_dev_commands.py [--json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from _loop_common import REPO_ROOT, load_json


def discover() -> dict:
    out: dict = {"webui": {}, "python": {}, "task_runners": [], "ci": [], "unresolved": []}

    # webui (Next.js / npm)
    pkg = REPO_ROOT / "webui" / "package.json"
    if pkg.exists():
        scripts = (load_json(pkg).get("scripts") or {})
        gates = {}
        if "lint" in scripts:
            gates["lint"] = {"command": "npm run lint", "cwd": "webui"}
        if "test" in scripts:
            gates["test"] = {"command": "npm run test", "cwd": "webui"}
        if "build" in scripts:
            gates["build"] = {"command": "npm run build", "cwd": "webui"}
        if (REPO_ROOT / "webui" / "tsconfig.json").exists():
            gates["typecheck"] = {"command": "npx tsc --noEmit", "cwd": "webui"}
        out["webui"] = {"scripts": scripts, "suggested_gates": gates}

    # python (pytest)
    if (REPO_ROOT / "pyproject.toml").exists():
        py = {"suggested_gates": {}}
        tests_dir = REPO_ROOT / "tests"
        if tests_dir.exists() or (REPO_ROOT / "pytest.ini").exists():
            py["suggested_gates"]["pytest"] = {"command": "python -m pytest -q", "cwd": "."}
        out["python"] = py

    for runner in ("Makefile", "justfile", "Taskfile.yml", "Taskfile.yaml"):
        if (REPO_ROOT / runner).exists():
            out["task_runners"].append(runner)

    wf = REPO_ROOT / ".github" / "workflows"
    if wf.exists():
        out["ci"] = [p.name for p in wf.glob("*.y*ml")]

    has_any = bool(out["webui"].get("suggested_gates")) or bool(out["python"].get("suggested_gates"))
    if not has_any:
        out["unresolved"].append(
            "検証コマンドを特定できません。hard gate を空にせず blocked にし、人間に確認すること。"
        )
    return out


def main(argv: list[str]) -> int:
    data = discover()
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0 if not data["unresolved"] else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
