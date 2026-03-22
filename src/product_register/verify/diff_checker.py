import csv
from pathlib import Path
from datetime import datetime

CONVERTER_FILE_MAP = {
    "rakuten": "src/product_register/converters/rakuten.py",
    "ne": "src/product_register/converters/ne.py",
    "yahoo": "src/product_register/converters/yahoo.py",
    "shopify": "src/product_register/converters/shopify.py",
}

def compare_csv(actual_path: Path, expected_path: Path, key_column: str | list[str],
                mall: str = "unknown") -> dict:
    """actual vs expected のCSVを比較し、構造化された差分結果を返す。
    key_column can be a single string or a list of strings for composite keys."""
    from product_register.verify.hint_enricher import enrich_hint

    actual_rows = _read_csv(actual_path)
    expected_rows = _read_csv(expected_path)

    def make_key(row: dict) -> str:
        if isinstance(key_column, list):
            return "|".join(str(row.get(k, "")).strip() for k in key_column)
        return str(row.get(key_column, "")).strip()

    actual_by_key = {make_key(r): r for r in actual_rows}
    expected_by_key = {make_key(r): r for r in expected_rows}

    mismatches = []
    missing = []
    extra = []
    matched = 0

    for key, exp_row in expected_by_key.items():
        if key not in actual_by_key:
            missing.append(key)
            continue
        act_row = actual_by_key[key]
        diffs = []
        for col in exp_row:
            exp_val = str(exp_row.get(col, "")).strip()
            act_val = str(act_row.get(col, "")).strip()
            if exp_val != act_val:
                diffs.append({
                    "column": col,
                    "expected": exp_val,
                    "actual": act_val,
                    "converter_file": CONVERTER_FILE_MAP.get(mall, "unknown"),
                    "hint": enrich_hint(mall, col, exp_val, act_val)
                })
        if diffs:
            mismatches.append({"row": list(expected_by_key.keys()).index(key) + 1,
                               "product_code": key, "diffs": diffs})
        else:
            matched += 1

    for key in actual_by_key:
        if key not in expected_by_key:
            extra.append(key)

    return {
        "timestamp": datetime.now().isoformat(),
        "mall": mall,
        "summary": {
            "total_rows": len(expected_by_key),
            "matched_rows": matched,
            "mismatched_rows": len(mismatches),
            "missing_rows": len(missing),
            "extra_rows": len(extra),
        },
        "mismatches": mismatches,
        "missing_keys": missing,
        "extra_keys": extra,
    }

def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))
