from __future__ import annotations

from product_register.converters.base import BaseConverter
from product_register.models import ProductInput

SHOPIFY_CDN_BASE = "https://cdn.shopify.com/s/files/1/0602/0992/2282/files/"

# All column keys in the Shopify CSV output (determines key ordering for consistency)
SHOPIFY_COLUMNS = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Type",
    "Tags",
    "Published",
    "Option1 Name",
    "Option1 Value",
    "Variant SKU",
    "Variant Grams",
    "Variant Inventory Tracker",
    "Variant Inventory Policy",
    "Variant Fulfillment Service",
    "Variant Price",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Variant Barcode",
    "Image Src",
    "Image Position",
    "Status",
    "Included / 日本",
    "Price / 日本",
    "Included / 国際",
]


def _generate_shopify_image_urls(ne_code: str, image_count: int) -> list[str]:
    """Shopify CDN画像URLを商品コード+枚数から生成"""
    urls = []
    for i in range(1, image_count + 1):
        suffix = "" if i == 1 else f"_{i}"
        urls.append(f"{SHOPIFY_CDN_BASE}{ne_code}{suffix}.jpg")
    return urls


class ShopifyConverter(BaseConverter):
    mall_name = "shopify"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        """ProductInputリストをShopify CSV用の辞書リストに変換する。

        1商品あたりN行（Nは画像枚数）に展開する。
        先頭行: 全フィールド設定
        2行目以降: Handle / Image Src / Image Position のみ（他は空文字）
        """
        rows: list[dict] = []
        for product in products:
            rows.extend(self._expand_product(product))
        return rows

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_image_urls(self, p: ProductInput) -> list[str]:
        """画像URLリストを取得。明示的なURLがあればそれを優先、なければ自動生成。"""
        explicit_urls = [getattr(p, f"image_url_{i}") for i in range(1, 21)]
        has_explicit = any(u for u in explicit_urls)

        if has_explicit:
            return [u for u in explicit_urls if u]
        else:
            return _generate_shopify_image_urls(p.ne_code, p.image_count)

    def _empty_row(self, handle: str) -> dict:
        """Handleのみ設定した空行テンプレートを返す。"""
        row = {col: "" for col in SHOPIFY_COLUMNS}
        row["Handle"] = handle
        return row

    def _build_first_row(self, p: ProductInput, image_url: str) -> dict:
        """先頭行（全フィールド）を構築する。"""
        row = self._empty_row(p.ne_code)

        row["Title"] = p.display_name
        row["Body (HTML)"] = p.description_pc
        row["Vendor"] = p.maker_name
        row["Type"] = ""
        row["Tags"] = p.keyword
        row["Published"] = "TRUE"

        # バリエーション設定
        if p.variation_name:
            row["Option1 Name"] = p.variation_name
            row["Option1 Value"] = p.variation_choices if p.variation_choices else ""
        else:
            row["Option1 Name"] = "Title"
            row["Option1 Value"] = "Default Title"

        # バリアント情報
        row["Variant SKU"] = p.ne_code
        row["Variant Grams"] = "0"
        row["Variant Inventory Tracker"] = "shopify"
        row["Variant Inventory Policy"] = "deny"
        row["Variant Fulfillment Service"] = "manual"
        row["Variant Price"] = str(p.selling_price)
        row["Variant Requires Shipping"] = "TRUE"
        row["Variant Taxable"] = "TRUE"
        row["Variant Barcode"] = p.jan_code

        # 画像
        row["Image Src"] = image_url
        row["Image Position"] = "1"

        # ステータス
        row["Status"] = "active"

        # マーケット
        row["Included / 日本"] = "TRUE"
        row["Price / 日本"] = str(p.selling_price)
        row["Included / 国際"] = "FALSE"

        return row

    def _build_image_row(self, handle: str, image_url: str, position: int) -> dict:
        """画像専用行（Handle / Image Src / Image Position のみ）を構築する。"""
        row = self._empty_row(handle)
        row["Image Src"] = image_url
        row["Image Position"] = str(position)
        return row

    def _expand_product(self, p: ProductInput) -> list[dict]:
        """1商品をN行（画像数）に展開する。"""
        image_urls = self._get_image_urls(p)

        if not image_urls:
            # 画像がない場合は1行だけ（Image Srcなし）
            return [self._build_first_row(p, "")]

        rows: list[dict] = []
        for i, url in enumerate(image_urls):
            if i == 0:
                rows.append(self._build_first_row(p, url))
            else:
                rows.append(self._build_image_row(p.ne_code, url, i + 1))

        return rows
