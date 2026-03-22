from __future__ import annotations
import re
from product_register.models import ProductInput
from product_register.converters.base import BaseConverter


def _strip_html(text: str) -> str:
    """HTMLタグを除去してプレーンテキストを返す"""
    return re.sub(r"<[^>]+>", "", text)


class YahooConverter(BaseConverter):
    mall_name = "yahoo"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        return [self._convert_one(p) for p in products]

    def _convert_one(self, p: ProductInput) -> dict:
        # 税率: int(8 or 10) → "0.08" or "0.1"
        taxrate_type = str(p.tax_rate / 100)

        # 画像URL: 設定済みURLをセミコロン連結、なければ自動生成
        image_urls = p.get_image_urls()
        if not image_urls:
            image_urls = [
                f"https://shopping.c.yimg.jp/lib/example/{p.ne_code}_{i}.jpg"
                for i in range(1, p.image_count + 1)
            ]
        item_image_urls = ";".join(image_urls)

        return {
            "item_code": p.ne_code,
            "name": p.display_name,
            "price": str(p.selling_price),
            "product_category": p.mall_category_id,
            "path": p.store_category,
            "headline": p.catch_copy_yahoo,
            "caption": p.description_pc,
            "explanation": _strip_html(p.free1),
            "additional1": p.free2,
            "taxrate_type": taxrate_type,
            "taxable": "1",
            "display": "1",
            "jan": p.jan_code,
            "item_image_urls": item_image_urls,
        }
