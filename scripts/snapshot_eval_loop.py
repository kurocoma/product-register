"""周回ごとの成果物を git の隠し ref に退避する（best-effort）。

  refs/eval-loop/<session-id>/iter-XXX

通常の index / stash list / 作業ツリーを汚さない（`git stash create` の commit を ref 化）。
失敗してもループ本体を止めない（常に exit 0、結果は .loop/current/snapshot.log）。

  python scripts/snapshot_eval_loop.py --iteration N [--session SID]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from _loop_common import LOOP_DIR, REPO_ROOT, now_iso


def _git(args: list[str], env: dict | None = None) -> tuple[int, str]:
    r = subprocess.run(
        ["git", *args], cwd=str(REPO_ROOT), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    return r.returncode, r.stdout.decode("utf-8", errors="replace").strip()


def _log(msg: str) -> None:
    LOOP_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOOP_DIR / "snapshot.log", "a", encoding="utf-8") as f:
        f.write(f"[{now_iso()}] {msg}\n")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration", type=int, required=True)
    ap.add_argument("--session", default="default")
    args = ap.parse_args(argv)
    tmp_index = None
    try:
        code, head = _git(["rev-parse", "HEAD"])
        if code != 0:
            _log(f"iter-{args.iteration:03d}: no HEAD ({head}) — skip")
            return 0
        # 一時 index に作業ツリー全体(追跡+未追跡, .gitignore は尊重)をステージし、
        # 本物の index / stash list / 作業ツリーを汚さずに full snapshot の tree を作る。
        fd, tmp_index = tempfile.mkstemp(prefix="evalloop_idx_")
        os.close(fd)
        os.remove(tmp_index)  # git は存在しないパスに新規 index を作る（空ファイルだと壊れ index 扱いになる）
        env = {**os.environ, "GIT_INDEX_FILE": tmp_index}
        c1, o1 = _git(["add", "-A"], env=env)
        c2, tree = _git(["write-tree"], env=env)
        if c1 != 0 or c2 != 0 or not tree:
            _log(f"iter-{args.iteration:03d}: add/write-tree failed: {o1} {tree}")
            return 0
        c3, commit = _git(
            ["commit-tree", tree, "-p", head, "-m", f"eval-loop snapshot iter {args.iteration}"]
        )
        sha = commit if (c3 == 0 and commit) else head
        ref = f"refs/eval-loop/{args.session}/iter-{args.iteration:03d}"
        code, out = _git(["update-ref", ref, sha])
        if code == 0:
            _log(f"{ref} -> {sha[:12]} ({'full-tree' if sha == commit else 'HEAD-fallback'}) ok")
        else:
            _log(f"iter-{args.iteration:03d}: update-ref failed: {out}")
    except Exception as e:  # noqa: BLE001
        _log(f"iter-{args.iteration:03d}: exception {e}")
    finally:
        if tmp_index and os.path.exists(tmp_index):
            try:
                os.remove(tmp_index)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
