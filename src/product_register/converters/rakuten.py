from __future__ import annotations

from product_register.converters.base import BaseConverter
from product_register.models import ProductInput
from product_register.config.image_url import generate_rakuten_image_urls


class RakutenConverter(BaseConverter):
    mall_name = "rakuten"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        """ProductInputリストを楽天CSV用の辞書リストに変換する。

        単品 → 属性="親"
        セット商品 → 属性="子"
        並び順: 商品管理番号昇順、同一番号内では 親 before 子
        """
        rows = [self._build_row(p) for p in products]

        def sort_key(row: dict) -> tuple:
            attr_order = 0 if row["属性"] == "親" else 1
            return (row["商品管理番号（商品URL）"], attr_order)

        rows.sort(key=sort_key)
        return rows

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_row(self, p: ProductInput) -> dict:
        is_parent = p.is_single  # 単品 → 親; セット商品 → 子
        row: dict = {}

        # 属性
        row["属性"] = "親" if is_parent else "子"

        # 商品管理番号（商品URL）
        row["商品管理番号（商品URL）"] = p.ne_code

        # 商品番号・商品名 (親のみ)
        row["商品番号"] = p.ne_code if is_parent else ""
        row["商品名"] = p.display_name if is_parent else ""

        # 消費税
        row["消費税率"] = str(p.tax_rate / 100)
        row["消費税"] = 0 if is_parent else ""

        # サーチ表示・倉庫指定 (親のみ)
        row["サーチ表示"] = 1 if is_parent else ""
        row["倉庫指定"] = 0 if is_parent else ""

        # キャッチコピー (親のみ)
        row["キャッチコピー"] = p.catch_copy_pc if is_parent else ""

        # 商品説明文 (親のみ)
        row["PC用商品説明文"] = p.description_pc if is_parent else ""
        row["スマートフォン用商品説明文"] = p.description_sp if is_parent else ""

        # カテゴリ
        row["モール基本カテゴリID"] = p.mall_category_id if is_parent else ""
        row["店舗内カテゴリ"] = p.store_category

        # キーワード (親のみ)
        row["キーワード"] = p.keyword if is_parent else ""

        # 画像URL 1〜20
        # image_url_N が設定されていれば優先、なければ image_count から自動生成
        explicit_urls = [getattr(p, f"image_url_{i}") for i in range(1, 21)]
        has_explicit = any(u for u in explicit_urls)

        if has_explicit:
            for i, url in enumerate(explicit_urls, start=1):
                row[f"画像URL{i}"] = url
        else:
            auto_urls = generate_rakuten_image_urls(p.ne_code, p.image_count)
            for i in range(1, 21):
                idx = i - 1
                row[f"画像URL{i}"] = auto_urls[idx] if idx < len(auto_urls) else ""

        # 商品属性 (1〜12): "0" → ""
        for i in range(1, 13):
            item_val = getattr(p, f"attribute_item_{i}", "")
            value_val = getattr(p, f"attribute_value_{i}", "")
            unit_val = getattr(p, f"attribute_unit_{i}", "")

            row[f"商品属性（項目）{i}"] = item_val
            row[f"商品属性（値）{i}"] = value_val
            row[f"商品属性（単位）{i}"] = "" if unit_val == "0" else unit_val

        return row
