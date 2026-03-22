from __future__ import annotations

from collections import defaultdict

from product_register.converters.base import BaseConverter
from product_register.models import ProductInput

SHOPIFY_CDN_BASE = "https://cdn.shopify.com/s/files/1/0602/0992/2282/files/"

SITE_NAME = "【くりま】沖縄県産品・特産品の通販サイト"
SEO_DESC_SUFFIX = "のことなら沖縄県産品・特産品の通販サイトくりま。沖縄から全国一律9800円以上購入で送料無料！単品購入で送料無料も多数。"

# All column keys in the Shopify CSV output (60 columns, matches expected format)
SHOPIFY_COLUMNS = [
    "Handle",
    "Image Src",
    "Image Position",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Product Category",
    "Type",
    "Tags",
    "Published",
    "Option1 Name",
    "Option1 Value",
    "Option1 Linked To",
    "Option2 Name",
    "Option2 Value",
    "Option2 Linked To",
    "Option3 Name",
    "Option3 Value",
    "Option3 Linked To",
    "Variant SKU",
    "Variant Grams",
    "Variant Inventory Tracker",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Fulfillment Service",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Variant Barcode",
    "Image Alt Text",
    "Gift Card",
    "SEO Title",
    "SEO Description",
    "Google Shopping / Google Product Category",
    "Google Shopping / Gender",
    "Google Shopping / Age Group",
    "Google Shopping / MPN",
    "Google Shopping / Condition",
    "Google Shopping / Custom Product",
    "Google Shopping / Custom Label 0",
    "Google Shopping / Custom Label 1",
    "Google Shopping / Custom Label 2",
    "Google Shopping / Custom Label 3",
    "Google Shopping / Custom Label 4",
    "Google: Custom Product (product.metafields.mm-google-shopping.custom_product)",
    "送料 (product.metafields.my_fields._0000)",
    "商品評価数 (product.metafields.reviews.rating_count)",
    "国 (product.metafields.shopify.country)",
    "Variant Image",
    "Variant Weight Unit",
    "Variant Tax Code",
    "Cost per item",
    "Included / 日本",
    "Price / 日本",
    "Compare At Price / 日本",
    "Included / 国際",
    "Price / 国際",
    "Compare At Price / 国際",
    "Status",
]


def _base_code(p: ProductInput) -> str:
    """Base code: maker_code + '-' + last 4 digits of jan_code"""
    return f"{p.maker_code}-{p.jan_code[-4:]}"


def _price_with_tax(p: ProductInput) -> int:
    """Tax-inclusive price: selling_price * (1 + tax_rate/100)"""
    return round(p.selling_price * (1 + p.tax_rate / 100))


def _generate_image_url(base: str, position: int) -> str:
    """Generate Shopify CDN image URL.

    Position 1: {base}-1.jpg
    Position 2+: {base}_{position}.jpg
    """
    if position == 1:
        return f"{SHOPIFY_CDN_BASE}{base}-1.jpg"
    return f"{SHOPIFY_CDN_BASE}{base}_{position}.jpg"


def _get_option1_value(p: ProductInput) -> str:
    """Determine Option1 Value for this product.

    The ne_code suffix (last segment after '-') is matched against variation_choices
    to find the applicable choice label.
    Append '(送料無料)' if shipping_type == '送料無料'.
    """
    if not p.variation_choices:
        return ""
    suffix = p.ne_code.rsplit("-", 1)[-1]
    choices = [c.strip() for c in p.variation_choices.split("|")]
    # Find the choice whose numeric digits match the suffix
    matched = None
    for choice in choices:
        digits = "".join(ch for ch in choice if ch.isdigit())
        if digits == suffix:
            matched = choice
            break
    if matched is None:
        matched = choices[0] if choices else ""
    if p.shipping_type == "送料無料":
        return f"{matched}(送料無料)"
    return matched


def _build_body_html(base: str, image_count: int, description_pc: str) -> str:
    """Build Body (HTML) with imgList section (images 2+) + description_pc."""
    img_tags = ""
    for i in range(2, image_count + 1):
        url = f"{SHOPIFY_CDN_BASE}{base}_{i}.jpg"
        img_tags += f'<img src="{url}" width="100%"><br>'
    img_list = f"<!--imgList-->{img_tags}<!--/imgList-->\n{description_pc}"
    return img_list


class ShopifyConverter(BaseConverter):
    mall_name = "shopify"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        """ProductInputリストをShopify CSV用の辞書リストに変換する。

        商品はbase_code（maker_code + JAN下4桁）でグループ化される。
        各グループはmax(image_count)行に展開される。
        各行にはHandle + Image Src + Image Position が設定される。
        先頭行: 全フィールド設定（代表商品の情報）
        バリアント行: 対応するProductInputのバリアント情報 + 画像
        残り行: Handle + 画像のみ
        """
        # Group by base_code, preserving insertion order within each group
        groups: dict[str, list[ProductInput]] = defaultdict(list)
        for p in products:
            groups[_base_code(p)].append(p)

        rows: list[dict] = []
        for base in sorted(groups.keys()):
            members = groups[base]
            rows.extend(self._expand_group(base, members))
        return rows

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _expand_group(self, base: str, members: list[ProductInput]) -> list[dict]:
        """Expand a group of products sharing the same base code into rows."""
        # Use the first product (単品 preferred) as the representative for
        # product-level fields (Title, Body, Vendor, Tags, SEO, etc.)
        rep = next((p for p in members if p.is_single), members[0])
        max_images = max(p.image_count for p in members)

        rows: list[dict] = []
        for pos in range(1, max_images + 1):
            image_url = _generate_image_url(base, pos)

            if pos == 1:
                # First row: all product fields + first variant fields
                row = self._build_first_row(base, rep, members[0], image_url)
            elif pos - 1 < len(members):
                # Subsequent rows with a variant to attach
                variant = members[pos - 1]
                row = self._build_variant_row(base, variant, image_url, pos)
            else:
                # Image-only row
                row = self._build_image_only_row(base, image_url, pos)

            rows.append(row)
        return rows

    def _empty_row(self, handle: str) -> dict:
        """Return a blank row template with only Handle set."""
        row = {col: "" for col in SHOPIFY_COLUMNS}
        row["Handle"] = handle
        return row

    def _fill_variant_fields(self, row: dict, p: ProductInput, base: str) -> None:
        """Fill variant-specific fields into row in-place."""
        row["Option1 Value"] = _get_option1_value(p)
        row["Variant SKU"] = p.ne_code
        row["Variant Grams"] = "0.0"
        row["Variant Inventory Tracker"] = "shopify"
        row["Variant Inventory Qty"] = "0"
        row["Variant Inventory Policy"] = "deny"
        row["Variant Fulfillment Service"] = "manual"
        row["Variant Price"] = str(_price_with_tax(p))
        row["Variant Requires Shipping"] = "true"
        row["Variant Taxable"] = "true"
        row["Variant Barcode"] = p.jan_code
        # Variant Image: CDN URL using ne_code as filename
        row["Variant Image"] = f"{SHOPIFY_CDN_BASE}{p.ne_code}.jpg"

    def _build_first_row(
        self,
        base: str,
        rep: ProductInput,
        first_variant: ProductInput,
        image_url: str,
    ) -> dict:
        """Build the first row with all product + variant fields."""
        row = self._empty_row(base)

        # Product-level fields (from representative)
        row["Title"] = rep.display_name
        row["Body (HTML)"] = _build_body_html(base, rep.image_count, rep.description_pc)
        row["Vendor"] = f"{rep.maker_name}<br>商品コード:{base}"
        row["Tags"] = f"{rep.maker_name},税率{rep.tax_rate}%"
        row["Published"] = "true"

        # Option1 Name (use variation_name if available, else fixed label)
        if rep.variation_name:
            row["Option1 Name"] = "セット数を選んでください"
        else:
            row["Option1 Name"] = "Title"

        # SEO
        row["Gift Card"] = "false"
        row["SEO Title"] = f"{rep.product_name}|{SITE_NAME}"
        row["SEO Description"] = f"{rep.product_name}{SEO_DESC_SUFFIX}"

        # Included markets
        row["Included / 日本"] = "true"
        row["Included / 国際"] = "true"

        # Status
        row["Status"] = "active"

        # Image
        row["Image Src"] = image_url
        row["Image Position"] = "1"

        # Variant fields for the first variant
        self._fill_variant_fields(row, first_variant, base)
        row["Variant Weight Unit"] = "kg"

        return row

    def _build_variant_row(
        self,
        base: str,
        variant: ProductInput,
        image_url: str,
        position: int,
    ) -> dict:
        """Build a row for a subsequent variant (image + variant fields, no product-level fields)."""
        row = self._empty_row(base)
        row["Image Src"] = image_url
        row["Image Position"] = str(position)
        self._fill_variant_fields(row, variant, base)
        return row

    def _build_image_only_row(self, base: str, image_url: str, position: int) -> dict:
        """Build an image-only row (Handle + Image Src + Image Position)."""
        row = self._empty_row(base)
        row["Image Src"] = image_url
        row["Image Position"] = str(position)
        return row
