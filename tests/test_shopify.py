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

def test_shopify_handle_generation():
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["Handle"] == "t002-2542-1"

def test_shopify_all_rows_share_handle():
    conv = ShopifyConverter()
    rows = conv.convert([make_product(image_count=3)])
    handles = {r["Handle"] for r in rows}
    assert len(handles) == 1

def test_shopify_status_active():
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["Status"] == "active"

def test_shopify_variant_sku():
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["Variant SKU"] == "t002-2542-1"

def test_multiple_products_image_expansion():
    """2商品(3画像+2画像) → 5行"""
    conv = ShopifyConverter()
    products = [
        make_product(ne_code="a-0001-1", image_count=3),
        make_product(ne_code="b-0002-1", image_count=2),
    ]
    rows = conv.convert(products)
    assert len(rows) == 5

def test_shopify_market_columns():
    """日本/国際マーケット列が含まれる"""
    conv = ShopifyConverter()
    rows = conv.convert([make_product()])
    assert "Included / 日本" in rows[0]
    assert "Included / 国際" in rows[0]
    assert rows[0]["Included / 日本"] == "TRUE"

def test_shopify_variant_price():
    conv = ShopifyConverter()
    rows = conv.convert([make_product(selling_price=10000)])
    assert rows[0]["Variant Price"] == "10000"
    assert rows[0]["Price / 日本"] == "10000"
