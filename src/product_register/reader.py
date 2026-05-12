import csv
from pathlib import Path
from product_register.models import ProductInput


def _parse_bool(v: str) -> bool:
    """CSV の文字列を bool に変換。空文字列は False。"""
    if not v:
        return False
    return v.strip().upper() in ("TRUE", "1", "YES")


def read_input_csv(path: Path) -> list[ProductInput]:
    """統一入力CSVを読み込んでProductInputリストを返す"""
    products = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cleaned = {}
            for key, value in row.items():
                if key is None:
                    continue
                cleaned[key.strip()] = value.strip() if value else ""
            # 数値フィールドの変換
            for int_field in ("quantity", "tax_rate", "cost_price", "selling_price",
                              "image_count", "delivery_method", "lead_time"):
                if int_field in cleaned and cleaned[int_field]:
                    cleaned[int_field] = int(cleaned[int_field])
                elif int_field in cleaned:
                    cleaned[int_field] = 0
            # bool フィールドの変換
            for bool_field in ("yahoo_grouping_enabled",):
                if bool_field in cleaned:
                    cleaned[bool_field] = _parse_bool(cleaned[bool_field])
            products.append(ProductInput(**cleaned))
    return products
