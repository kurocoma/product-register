#!/usr/bin/env bash
# spec 互換の薄いラッパ。実体は cross-platform な Python 版。
# usage: snapshot_eval_loop.sh --iteration N [--session SID]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python "$DIR/snapshot_eval_loop.py" "$@"
