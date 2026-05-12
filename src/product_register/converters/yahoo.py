from __future__ import annotations
import logging
import math
import re
from product_register.models import ProductInput
from product_register.converters.base import BaseConverter

logger = logging.getLogger(__name__)


YAHOO_COLUMNS = [
    "path", "name", "code", "sub-code", "original-price", "price", "sale-price", "member-price",
    "options", "headline", "caption", "abstract", "explanation", "additional1", "additional2", "additional3",
    "ship-weight", "taxable", "release-date", "point-code", "meta-desc", "sale-period-start", "sale-period-end", "sale-limit",
    "sp-code", "pr-rate", "brand-code", "product-code", "jan", "delivery", "condition", "product-category",
    "spec1", "spec2", "spec3", "spec4", "spec5", "spec6", "spec7", "spec8", "spec9", "spec10",
    "display", "sp-additional", "sort_priority",
    "original-price-evidence", "lead-time-instock", "lead-time-outstock", "keep-stock", "postage-set", "taxrate-type", "item-tag",
    "reserve-price", "reserve-sale-price", "reserve-member-price", "reserve-selling-period-start", "reserve-selling-period-end",
    "subscription-type", "subscription-price", "subscription-group-index", "subscription-recommended-cycle", "subscription-point-code",
    "video", "point-immediate", "eco-setting-id", "eco-setting-evidence-url",
    "grouping-id", "variation1-spec-id", "variation1-free-title", "variation1-name",
    "variation2-spec-id", "variation2-free-title", "variation2-name",
    "variation3-spec-id", "variation3-free-title", "variation3-name",
    "variation4-spec-id", "variation4-free-title", "variation4-name",
    "variation5-spec-id", "variation5-free-title", "variation5-name",
    "item-social-gift-type", "cross-border-agency-flag", "item-image-urls",
]


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


def _to_single_quotes(html: str) -> str:
    return html.replace('"', "'")


def _build_img_list(ne_code: str, image_count: int) -> str:
    if image_count <= 1:
        return ""
    base = f"https://shopping.c.yimg.jp/lib/okimarumarket/{ne_code}"
    parts = []
    for i in range(2, image_count + 1):
        parts.append(f"<img src='{base}_{i}.jpg' width='100%'>")
    return "<!--imgList-->" + "<br>".join(parts) + "<br><!--/imgList-->"


def _build_caption(ne_code: str, image_count: int, description_pc: str) -> str:
    img_html = _build_img_list(ne_code, image_count)
    desc_html = _to_single_quotes(description_pc)
    return img_html + desc_html


def _build_explanation(free1: str, description_pc: str) -> str:
    source = free1 if free1 else description_pc
    return _strip_html(source)


def _resolve_grouping_id(ne_code: str, enabled: bool) -> str:
    """yahoo_grouping_enabled=True のとき ne_code 末尾の -数字のみ を取り除く。

    末尾が「ハイフン + 数字のみ」のときだけ trim する。S01 のように英字を含む
    場合は ne_code そのまま返す。
    """
    if not enabled:
        return ""
    parts = ne_code.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0]
    return ne_code


def _build_variation_name(quantity: int, unit: str) -> str:
    """quantity と unit から variation1-name を生成。

    例: quantity=1, unit="袋" → "1袋"
    例: quantity=5, unit="袋" → "5袋セット"
    """
    if quantity == 1:
        return f"1{unit}"
    return f"{quantity}{unit}セット"


def _build_item_image_urls(ne_code: str, image_count: int) -> str:
    """画像URL をセミコロン区切りで生成。1枚目はサフィックスなし、N≥2 は _N。"""
    if image_count <= 0:
        return ""
    base = "https://shopping.c.yimg.jp/lib/okimarumarket"
    urls = []
    for i in range(1, image_count + 1):
        suffix = "" if i == 1 else f"_{i}"
        urls.append(f"{base}/{ne_code}{suffix}.jpg")
    return ";".join(urls)


class YahooConverter(BaseConverter):
    mall_name = "yahoo"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        return [self._convert_one(p) for p in products]

    def _convert_one(self, p: ProductInput) -> dict:
        if p.yahoo_grouping_enabled and not p.unit:
            logger.warning(
                f"ne_code={p.ne_code}: yahoo_grouping_enabled=True だが unit が空。"
                f"variation1-name が壊れた値になる可能性"
            )

        tax_inclusive = str(math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5))
        taxrate_type = str(p.tax_rate / 100)

        caption = _build_caption(p.ne_code, p.image_count, p.description_pc)
        explanation = _build_explanation(p.free1, p.description_pc)

        grouping_id = _resolve_grouping_id(p.ne_code, p.yahoo_grouping_enabled)
        variation1_title = p.yahoo_variation_title if p.yahoo_grouping_enabled else ""
        variation1_name = _build_variation_name(p.quantity, p.unit) if p.yahoo_grouping_enabled else ""

        item_image_urls = _build_item_image_urls(p.ne_code, p.image_count)

        row = {col: "" for col in YAHOO_COLUMNS}
        row.update({
            "path": p.yahoo_path,
            "name": p.display_name,
            "code": p.ne_code,
            "original-price": tax_inclusive,
            "price": tax_inclusive,
            "headline": p.catch_copy_yahoo,
            "caption": caption,
            "explanation": explanation,
            "ship-weight": "1",
            "taxable": "1",
            "jan": p.jan_code,
            "delivery": "0",
            "condition": "0",
            "product-category": p.yahoo_category_id,
            "display": "1",
            "sp-additional": caption,
            "lead-time-instock": str(p.lead_time),
            "lead-time-outstock": str(p.lead_time),
            "keep-stock": "1",
            "postage-set": str(p.delivery_method),
            "taxrate-type": taxrate_type,
            "grouping-id": grouping_id,
            "variation1-free-title": variation1_title,
            "variation1-name": variation1_name,
            "item-image-urls": item_image_urls,
        })
        return row
