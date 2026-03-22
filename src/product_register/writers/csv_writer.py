import csv
from pathlib import Path

def write_csv(rows: list[dict], output_path: Path, encoding: str = "utf-8-sig") -> None:
    """辞書リストをCSVファイルに書き出す"""
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding=encoding, newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
