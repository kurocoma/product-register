"""eval-loop 共有ヘルパ（依存: 標準ライブラリ + 可能なら PyYAML）。

すべてのスクリプトは自身の位置から repo root を解決するためロケーション非依存。
.loop/current 配下のファイル I/O・ハッシュ計算・YAML/JSON 読込をここに集約する。
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

# Windows コンソール(cp932)でも日本語 JSON/メッセージを安全に出力する
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def find_repo_root(start: str | None = None) -> Path:
    """`.git` を持つ最も近い祖先を repo root とみなす。見つからなければ scripts の親。"""
    p = Path(start or __file__).resolve()
    for cand in [p, *p.parents]:
        if (cand / ".git").exists():
            return cand
    return Path(__file__).resolve().parent.parent


# 通常は repo を自動解決。smoke test 等の隔離実行のため環境変数で上書き可能。
_env_root = os.environ.get("EVAL_LOOP_REPO_ROOT")
REPO_ROOT = Path(_env_root).resolve() if _env_root else find_repo_root()
_env_loop = os.environ.get("EVAL_LOOP_DIR")
LOOP_DIR = Path(_env_loop).resolve() if _env_loop else REPO_ROOT / ".loop" / "current"
TURNS_DIR = LOOP_DIR / "turns"
_env_val = os.environ.get("EVAL_LOOP_VALIDATION")
VALIDATION_DIR = Path(_env_val).resolve() if _env_val else REPO_ROOT / "validation"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------
def load_json(path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# YAML （PyYAML 優先・無い場合は限定サブセットの自前パーサにフォールバック）
# ---------------------------------------------------------------------------
def load_yaml(path):
    text = Path(path).read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        return yaml.safe_load(text)
    except Exception:
        return _mini_yaml(text)


def _coerce(val: str):
    s = val.strip()
    if s == "" or s == "~" or s == "null":
        return None
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    if s in ("true", "True"):
        return True
    if s in ("false", "False"):
        return False
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


def _mini_yaml(text: str):
    """eval-loop が author する範囲のみを扱う最小 YAML パーサ（フォールバック専用）。

    対応: 2スペースインデントのネストmapping / `- ` リスト / list-of-map / スカラ。
    インラインコメントは扱わないので author 側で使わないこと。
    """
    root: dict = {}
    stack = [(-1, root)]  # (indent, container)

    def parent_for(indent):
        while stack and stack[-1][0] >= indent:
            stack.pop()
        return stack[-1][1]

    lines = [ln.rstrip("\n") for ln in text.splitlines()]
    i = 0
    pending_list_item = None  # for list-of-map継続
    while i < len(lines):
        raw = lines[i]
        if not raw.strip() or raw.strip().startswith("#"):
            i += 1
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        content = raw.strip()
        cont = parent_for(indent)
        if content.startswith("- "):
            item_text = content[2:].strip()
            if isinstance(cont, dict):
                # 直前の key にぶら下がる list を探す（最後に追加したkeyが list のはず）
                raise ValueError("mini-yaml: unexpected list under mapping")
            if ":" in item_text and not item_text.startswith(('"', "'")):
                # list-of-map の最初の key
                d = {}
                k, _, v = item_text.partition(":")
                d[k.strip()] = _coerce(v)
                cont.append(d)
                stack.append((indent + 2, d))
            else:
                cont.append(_coerce(item_text))
        elif content.endswith(":"):
            key = content[:-1].strip()
            # 子要素を覗いて list か map かを決める
            child_is_list = False
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].strip().startswith("#")):
                j += 1
            if j < len(lines):
                cj = lines[j]
                ind_j = len(cj) - len(cj.lstrip(" "))
                if ind_j > indent and cj.strip().startswith("- "):
                    child_is_list = True
            new_container = [] if child_is_list else {}
            cont[key] = new_container
            stack.append((indent, new_container))
        else:
            key, _, val = content.partition(":")
            cont[key.strip()] = _coerce(val)
        i += 1
    return root


# ---------------------------------------------------------------------------
# ハッシュ
# ---------------------------------------------------------------------------
def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_paths(root, rel_paths):
    """指定の相対パス（ファイル/ディレクトリ）配下の全ファイル内容から決定的ハッシュを得る。

    返り値: (combined_hash, [対象ファイルrelpath...])。
    実装変更検知（implementation_hash）に使う。
    """
    root = Path(root)
    entries = []
    skip_parts = {"node_modules", ".next", ".git", "__pycache__", ".turbo"}
    for rel in rel_paths:
        target = root / rel
        if target.is_file():
            entries.append((Path(rel).as_posix(), sha256_file(target)))
        elif target.is_dir():
            for f in sorted(target.rglob("*")):
                if f.is_file() and not (set(f.parts) & skip_parts):
                    entries.append((f.relative_to(root).as_posix(), sha256_file(f)))
    entries.sort()
    digest = hashlib.sha256()
    for r, hh in entries:
        digest.update(r.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hh.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest(), [r for r, _ in entries]
