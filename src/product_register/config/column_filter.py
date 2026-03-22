import json
from pathlib import Path


def load_column_filter(config_path: Path) -> list[str]:
    """enabled=true の列名リストを返す"""
    with open(config_path, encoding="utf-8") as f:
        columns = json.load(f)
    return [c["name"] for c in columns if c.get("enabled", True)]


def apply_column_filter(rows: list[dict], enabled_columns: list[str]) -> list[dict]:
    """有効列のみに絞り込む"""
    return [{k: v for k, v in row.items() if k in enabled_columns} for row in rows]
