from conftest import make_product
from product_register.converters.shopify import ShopifyConverter


def test_shopify_image_expansion():
    """3画像 → 3行に展開される"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product(image_count=3)])
    assert len(rows) == 3
    assert rows[0]["Title"] != ""
    assert rows[0]["Image Position"] == "1"
    assert rows[1]["Title"] == ""
    assert rows[1]["Image Position"] == "2"
    assert rows[2]["Image Position"] == "3"


def test_shopify_handle_is_base_code():
    """Handle = maker_code + '-' + jan_code[-4:], NOT the full ne_code"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    # make_product: maker_code="t002", jan_code="4955028002542" → base="t002-2542"
    assert rows[0]["Handle"] == "t002-2542"


def test_shopify_all_rows_share_handle():
    """展開された全行が同じHandleを持つ"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product(image_count=3)])
    handles = {r["Handle"] for r in rows}
    assert len(handles) == 1


def test_shopify_status_active():
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["Status"] == "active"


def test_shopify_variant_sku():
    """Variant SKU = ne_code (full code, not base code)"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["Variant SKU"] == "t002-2542-1"


def test_multiple_products_different_base_expansion():
    """2商品(異なるbase、3画像+2画像) → 5行"""
    conv = ShopifyConverter()
    products = [
        make_product(
            ne_code="a001-0001-1",
            maker_code="a001",
            jan_code="4900000000001",
            image_count=3,
        ),
        make_product(
            ne_code="b002-0002-1",
            maker_code="b002",
            jan_code="4900000000002",
            image_count=2,
        ),
    ]
    rows = conv.convert(products)
    assert len(rows) == 5


def test_multiple_products_same_base_grouping():
    """同じbase_codeを持つ2商品 → max(image_count)行にまとめられる"""
    conv = ShopifyConverter()
    products = [
        make_product(
            ne_code="t002-2542-1",
            maker_code="t002",
            jan_code="4955028002542",
            image_count=3,
        ),
        make_product(
            ne_code="t002-2542-3",
            maker_code="t002",
            jan_code="4955028002542",
            image_count=3,
        ),
    ]
    rows = conv.convert(products)
    # Both share handle "t002-2542", max image_count=3 → 3 rows
    assert len(rows) == 3
    handles = {r["Handle"] for r in rows}
    assert handles == {"t002-2542"}


def test_shopify_market_columns():
    """日本/国際マーケット列が含まれる"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert "Included / 日本" in rows[0]
    assert "Included / 国際" in rows[0]
    assert rows[0]["Included / 日本"] == "true"


def test_shopify_variant_price_with_tax():
    """Variant Price = selling_price * (1 + tax_rate/100)"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product(selling_price=10000, tax_rate=10)])
    assert rows[0]["Variant Price"] == "11000"


def test_shopify_image_url_format():
    """Image 1 uses -1.jpg suffix, Image 2+ uses _N.jpg suffix"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product(image_count=3)])
    # make_product: maker_code="t002", jan_code="4955028002542" → base="t002-2542"
    assert rows[0]["Image Src"].endswith("t002-2542-1.jpg")
    assert rows[1]["Image Src"].endswith("t002-2542_2.jpg")
    assert rows[2]["Image Src"].endswith("t002-2542_3.jpg")


def test_shopify_column_count():
    """出力には60列が含まれる"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert len(rows[0]) == 60


def test_shopify_vendor_format():
    """Vendor = maker_name + <br>商品コード: + base_code"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    # make_product has no maker_name default, base = t002-2542
    # Vendor should contain 商品コード:t002-2542
    assert "商品コード:t002-2542" in rows[0]["Vendor"]


def test_shopify_seo_fields():
    """SEO Title and Description are populated"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["SEO Title"] != ""
    assert rows[0]["SEO Description"] != ""
    assert "くりま" in rows[0]["SEO Title"]
