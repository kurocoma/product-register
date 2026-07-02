#!/usr/bin/env python
"""PreCompact hook。圧縮前に state / progress / 次の一手が保存されているか確認・記録する。

圧縮後は会話記憶でなくファイルから復元できる状態を保証するのが目的。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


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
    if not state_path.exists():
        sys.exit(0)

    missing = [
        name
        for name in ("state.json", "progress.md", "task.md", "acceptance.yaml", "criteria.yaml")
        if not (loop / name).exists()
    ]
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
    try:
        with open(loop / "precompact.log", "a", encoding="utf-8") as f:
            f.write(f"[{stamp}] precompact trigger={payload.get('trigger')} missing={missing}\n")
    except Exception:
        pass

    note = (
        "## eval-loop PreCompact チェックポイント\n"
        "圧縮後は .loop/current/state.json と turns/ から復元すること（会話記憶に依存しない）。"
    )
    if missing:
        note += f"\n警告: 未保存ファイルあり {missing} — 圧縮前に保存を確認。"
    out = {"hookSpecificOutput": {"hookEventName": "PreCompact", "additionalContext": note}}
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
