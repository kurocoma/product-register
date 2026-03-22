from conftest import make_product
from product_register.converters.yahoo import YahooConverter


def test_yahoo_code():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383", yahoo_path="沖縄のお酒")])
    assert rows[0]["code"] == "t002-2542-1"


def test_yahoo_tax_inclusive_price():
    """price is tax-inclusive: 10000 * 1.1 = 11000"""
    conv = YahooConverter()
    rows = conv.convert([make_product(selling_price=10000, tax_rate=10, yahoo_category_id="41383")])
    assert rows[0]["price"] == "11000"


def test_yahoo_tax_inclusive_price_8pct():
    """800 * 1.08 = 864"""
    conv = YahooConverter()
    rows = conv.convert([make_product(selling_price=800, tax_rate=8, yahoo_category_id="20946")])
    assert rows[0]["price"] == "864"


def test_yahoo_taxrate_type():
    conv = YahooConverter()
    rows = conv.convert([make_product(tax_rate=10, yahoo_category_id="41383")])
    assert rows[0]["taxrate-type"] == "0.1"


def test_yahoo_taxrate_type_8pct():
    conv = YahooConverter()
    rows = conv.convert([make_product(tax_rate=8, yahoo_category_id="20946")])
    assert rows[0]["taxrate-type"] == "0.08"


def test_yahoo_category():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383", yahoo_path="沖縄のお酒")])
    assert rows[0]["product-category"] == "41383"
    assert rows[0]["path"] == "沖縄のお酒"


def test_yahoo_42_columns():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert len(rows[0]) == 42


def test_yahoo_display():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["display"] == "1"


def test_yahoo_keep_stock():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["keep-stock"] == "1"


def test_yahoo_delivery_defaults():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["delivery"] == "0"
    assert rows[0]["condition"] == "0"
    assert rows[0]["taxable"] == "1"
    assert rows[0]["ship-weight"] == "1"


def test_yahoo_lead_time():
    conv = YahooConverter()
    rows = conv.convert([make_product(lead_time=3, yahoo_category_id="41383")])
    assert rows[0]["lead-time-instock"] == "3"
    assert rows[0]["lead-time-outstock"] == "3"


def test_yahoo_postage_set():
    conv = YahooConverter()
    rows = conv.convert([make_product(delivery_method=1, yahoo_category_id="41383")])
    assert rows[0]["postage-set"] == "1"


def test_yahoo_caption_contains_imglist():
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=3, yahoo_category_id="41383")])
    caption = rows[0]["caption"]
    assert "<!--imgList-->" in caption
    assert "<!--/imgList-->" in caption
    assert "okimarumarket/t002-2542-1_2.jpg" in caption
    assert "okimarumarket/t002-2542-1_3.jpg" in caption


def test_yahoo_sp_additional_equals_caption():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["sp-additional"] == rows[0]["caption"]


def test_yahoo_original_price_equals_price():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["original-price"] == rows[0]["price"]
