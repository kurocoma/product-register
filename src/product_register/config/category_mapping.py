import csv
from pathlib import Path


def load_category_mapping(path: Path) -> dict[str, dict]:
    """楽天ジャンルID → {yahoo_category_id, yahoo_path_example, ...}"""
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return {row["rakuten_genre_id"]: row for row in reader}
