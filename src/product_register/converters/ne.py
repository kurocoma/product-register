from __future__ import annotations
from product_register.converters.base import BaseConverter
from product_register.models import ProductInput


class NEConverter(BaseConverter):
    """Next Engine 用コンバーター。単品リストとセット商品リストの2つを返す。"""

    mall_name = "ne"

    def convert(self, products: list[ProductInput]) -> tuple[list[dict], list[dict]]:  # type: ignore[override]
        """ProductInputリストを (単品rows, セット商品rows) のタプルに変換する。"""
        singles: list[dict] = []
        sets: list[dict] = []

        for p in products:
            row = self._map_fields(p)
            if p.is_single:
                singles.append(row)
            else:
                sets.append(row)

        return singles, sets

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _map_fields(self, p: ProductInput) -> dict:
        soryo_kbn = "0" if p.shipping_type == "送料無料" else "1"
        image_url = p.image_url_1 if p.image_url_1 else ""

        return {
            "syohin_code": p.ne_code,
            "sire_code": p.maker_code,
            "syohin_name": p.product_name,
            "baika_tnk": str(p.selling_price),
            "genka_tnk": str(p.cost_price),
            "jan_code": p.jan_code,
            "tax_rate": str(p.tax_rate),
            "daihyo_syohin_code": p.ne_code,
            "image_url_http": image_url,
            "toriatukai_kbn": "0",
            "zei_kbn": "0",
            "display": "1",
            "catch_copy1": p.catch_copy_pc,
            "setumei1": p.description_pc,
            "setumei2": p.description_sp,
            "keyword": p.keyword,
            "moru_kihon_category_code": p.mall_category_id,
            "tenpo_kihon_category1": p.store_category,
            "soryo_kbn": soryo_kbn,
        }
