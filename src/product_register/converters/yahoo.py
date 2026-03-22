from __future__ import annotations
import math
import re
from product_register.models import ProductInput
from product_register.converters.base import BaseConverter

# Yahoo Shopping CSV の42列（ハイフン区切り名）
YAHOO_COLUMNS = [
    "code", "path", "display", "name",
    "original-price", "original-price-evidence", "price",
    "sale-price", "sale-period-start", "sale-period-end", "release-date",
    "product-category", "brand-code",
    "spec1", "spec2", "spec3", "spec4", "spec5",
    "jan", "product-code", "sp-code", "sub-code",
    "lead-time-instock", "lead-time-outstock", "keep-stock",
    "options", "headline", "abstract", "explanation",
    "caption", "point-code",
    "delivery", "postage-set", "ship-weight",
    "condition", "taxable", "taxrate-type", "sale-limit",
    "sp-additional", "meta-desc", "relevant-links", "sort_priority",
]


def _strip_html(text: str) -> str:
    """HTMLタグを除去してプレーンテキストを返す"""
    return re.sub(r"<[^>]+>", "", text)


def _to_single_quotes(html: str) -> str:
    """HTML属性のダブルクォートをシングルクォートに変換"""
    return html.replace('"', "'")


def _build_img_list(ne_code: str, image_count: int) -> str:
    """Yahoo用の画像リストHTML（画像2番目以降）を生成する。
    画像1はメイン商品画像なので imgList には含めない。
    """
    if image_count <= 1:
        return ""
    base = f"https://shopping.c.yimg.jp/lib/okimarumarket/{ne_code}"
    parts = []
    for i in range(2, image_count + 1):
        parts.append(f"<img src='{base}_{i}.jpg' width='100%'>")
    return "<!--imgList-->" + "<br>".join(parts) + "<br><!--/imgList-->"


def _build_caption(ne_code: str, image_count: int, description_pc: str) -> str:
    """caption / sp-additional 用のHTML: imgList + description_pc"""
    img_html = _build_img_list(ne_code, image_count)
    desc_html = _to_single_quotes(description_pc)
    return img_html + desc_html


def _build_explanation(free1: str, description_pc: str) -> str:
    """explanation: free1のプレーンテキスト。なければ description_pc からHTMLを除去"""
    source = free1 if free1 else description_pc
    return _strip_html(source)


class YahooConverter(BaseConverter):
    mall_name = "yahoo"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        return [self._convert_one(p) for p in products]

    def _convert_one(self, p: ProductInput) -> dict:
        # 税込価格 = selling_price * (1 + tax_rate/100)
        tax_inclusive = str(math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5))

        # 税率: 8 → "0.08", 10 → "0.1"
        taxrate_type = str(p.tax_rate / 100)

        # caption / sp-additional
        caption = _build_caption(p.ne_code, p.image_count, p.description_pc)

        # explanation (プレーンテキスト)
        explanation = _build_explanation(p.free1, p.description_pc)

        row = {col: "" for col in YAHOO_COLUMNS}
        row.update({
            "code": p.ne_code,
            "path": p.yahoo_path,
            "display": "1",
            "name": p.display_name,
            "original-price": tax_inclusive,
            "price": tax_inclusive,
            "product-category": p.yahoo_category_id,
            "jan": p.jan_code,
            "lead-time-instock": str(p.lead_time),
            "lead-time-outstock": str(p.lead_time),
            "keep-stock": "1",
            "headline": p.catch_copy_yahoo,
            "explanation": explanation,
            "caption": caption,
            "delivery": "0",
            "postage-set": str(p.delivery_method),
            "ship-weight": "1",
            "condition": "0",
            "taxable": "1",
            "taxrate-type": taxrate_type,
            "sp-additional": caption,
        })
        return row
