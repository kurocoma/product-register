#!/usr/bin/env python
"""evaluator 専用 PreToolUse(Bash) ガード。破壊的・状態変更系コマンドを拒否する。

evaluator は read-only 採点係。成果物・契約・テストを変更してはならない。
許可: test / lint / typecheck / build / grep / cat / sed -n / jq / git diff/status /
      find / ls / wc / python scripts/run_hard_gates.py / check_goal_completion.py 等。
拒否（denylist）: ファイル書込・削除・移動・git 変更・依存変更・apply_patch 等。

deny 時は exit 2 + stderr（PreToolUse はこれでツール呼び出しをブロックしモデルへ理由提示）。
例外が必要なら .loop/current/decisions.md に理由を記録すること。
"""
from __future__ import annotations

import json
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# 破壊的/状態変更コマンド（マッチしたら拒否）
DENY_PATTERNS = [
    (r"(^|[\s;&|])rm\s", "rm（削除）"),
    (r"(^|[\s;&|])rmdir\s", "rmdir"),
    (r"(^|[\s;&|])mv\s", "mv（移動/改名）"),
    (r"(^|[\s;&|])cp\s", "cp（上書きの恐れ）"),
    (r"(^|[\s;&|])del\s", "del"),
    (r"(^|[\s;&|])truncate\s", "truncate"),
    (r"(^|[\s;&|])dd\s", "dd"),
    (r"(^|[\s;&|])tee\b", "tee（ファイル書込）"),
    (r"\bsed\b[^|]*\s-i", "sed -i（インプレース編集）"),
    (r"\bperl\b[^|]*\s-p?i", "perl -i（インプレース編集）"),
    (r"\bgit\s+(checkout|reset|clean|add|commit|stash|rebase|merge|restore|push|rm|mv|apply)\b",
     "git 状態変更（diff/status/show のみ可）"),
    (r"\bapply_patch\b", "apply_patch"),
    (r"\b(npm|pnpm|yarn)\s+(install|i|ci|add|remove|uninstall|update|upgrade)\b", "依存変更"),
    (r"\bpip\s+install\b", "pip install"),
    (r"\bnpx\s+\S*(create|add)\b", "npx create/add（生成）"),
    (r">>\s*\S", "追記リダイレクト（ファイル書込）"),
    (r"\bchmod\b", "chmod"),
    (r"\bchown\b", "chown"),
]

# 上書きリダイレクト `>` のうち /dev/null・&N 以外をファイル書込とみなして拒否
REDIR = re.compile(r"(?<!\d)>(?!&)\s*([^\s;&|]+)")
SAFE_REDIR_TARGETS = {"/dev/null", "nul", "NUL"}


def is_denied(cmd: str):
    for pat, label in DENY_PATTERNS:
        if re.search(pat, cmd):
            return label
    for m in REDIR.finditer(cmd):
        target = m.group(1)
        if target not in SAFE_REDIR_TARGETS:
            return f"上書きリダイレクト > {target}（ファイル書込）"
    return None


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    cmd = ((payload.get("tool_input") or {}).get("command")) or ""
    label = is_denied(cmd)
    if label:
        sys.stderr.write(
            f"[guard-evaluator-bash] 拒否: {label}\n"
            "evaluator は read-only 採点係です。成果物・契約・テストを変更できません。"
            "検証は test/lint/typecheck/build/grep/git diff 等の読取系で行ってください。\n"
        )
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
