import csv
from pathlib import Path
from product_register.models import ProductInput

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
            products.append(ProductInput(**cleaned))
    return products
