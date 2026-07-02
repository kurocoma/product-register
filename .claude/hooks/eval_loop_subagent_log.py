#!/usr/bin/env python
"""SubagentStart / SubagentStop hook。subagent の起動・終了を JSONL で記録する。

記録: hook_event / agent_id / agent_type / transcript_path / turn番号 / 時刻。
コンテキスト分離契約の監査証跡（generator/evaluator が fork で別々に走ったことの確認）。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path


def find_repo_root(start: Path) -> Path:
    for cand in [start, *start.parents]:
        if (cand / ".git").exists() or (cand / ".loop").exists():
            return cand
    return start


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    cwd = Path(payload.get("cwd") or ".").resolve()
    root = find_repo_root(cwd)
    loop = root / ".loop" / "current"
    state_path = loop / "state.json"
    iteration = None
    if state_path.exists():
        try:
            iteration = json.loads(state_path.read_text(encoding="utf-8")).get("iteration")
        except Exception:
            iteration = None

    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        "hook_event": payload.get("hook_event_name"),
        "iteration": iteration,
        "agent_id": payload.get("agent_id") or payload.get("agentId"),
        "agent_type": payload.get("agent_type") or payload.get("subagent_type") or payload.get("agentType"),
        "transcript_path": payload.get("transcript_path"),
        "session_id": payload.get("session_id"),
    }
    try:
        loop.mkdir(parents=True, exist_ok=True)
        with open(loop / "subagents.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
