#!/usr/bin/env python
"""SessionStart hook。会話履歴全文ではなく state から「現在地」だけを再注入する。

ファイルから復元する原則（会話記憶に依存しない）を担保する。
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
    state_path = root / ".loop" / "current" / "state.json"
    if not state_path.exists():
        sys.exit(0)
    try:
        st = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        sys.exit(0)
    if st.get("status") in (None,) and not st.get("active"):
        sys.exit(0)

    it = st.get("iteration", 0)
    nxt = int(it) + 1
    lines = [
        "## eval-loop 現在地（state.json から再注入 / 会話履歴ではない）",
        f"- status={st.get('status')} active={st.get('active')}",
        f"- iteration={it} (max={st.get('max')}) score={st.get('score')}/{st.get('threshold')}",
        f"- hard_gates_passed={st.get('hard_gates_passed')} consecutive_passes={st.get('consecutive_passes')}/{st.get('required_consecutive_passes')}",
        f"- plateau_count={st.get('plateau_count')} blocked_reason={st.get('blocked_reason')}",
        "- 参照: task=.loop/current/task.md acceptance=.loop/current/acceptance.yaml criteria=.loop/current/criteria.yaml",
        f"- 直前eval: {st.get('last_eval_file')}",
        f"- 次に書く plan: .loop/current/turns/turn-{nxt:03d}-plan.md",
    ]
    if st.get("active") and st.get("status") == "running":
        lines.append(f"- 続行中: turn-{nxt:03d} を1周。task を読み直し→plan→generate(fork)→hard_gates→evaluate(fork)→record_eval。")
    elif st.get("status") == "completed":
        lines.append("- 完了済み: python scripts/check_goal_completion.py --json で確認可。")
    elif st.get("status") == "blocked":
        lines.append("- blocked: 人間判断が必要。blocked_reason を解消し state を更新してから再開。")

    out = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": "\n".join(lines),
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
