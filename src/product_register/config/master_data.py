import csv
from pathlib import Path


def load_maker_codes(path: Path) -> dict[str, dict]:
    """メーカーコード → {name, code, serial, product_code}"""
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return {row["メーカーコード"]: row for row in reader}
