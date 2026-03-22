from conftest import make_product
from product_register.converters.yahoo import YahooConverter

def test_yahoo_required_fields():
    conv = YahooConverter()
    rows = conv.convert([make_product()])
    row = rows[0]
    assert row["item_code"] == "t002-2542-1"
    assert row["name"] == "巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度"
    assert row["price"] == "10000"
    assert row["product_category"] == "402930"

def test_yahoo_tax_rate():
    conv = YahooConverter()
    rows = conv.convert([make_product(tax_rate=10)])
    assert rows[0]["taxrate_type"] == "0.1"

def test_yahoo_tax_rate_8():
    conv = YahooConverter()
    rows = conv.convert([make_product(tax_rate=8)])
    assert rows[0]["taxrate_type"] == "0.08"

def test_yahoo_headline():
    conv = YahooConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["headline"] == "毎年完売 プロ野球ボトル"

def test_yahoo_display_flag():
    conv = YahooConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["display"] == "1"

def test_yahoo_path():
    conv = YahooConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["path"] == "沖縄のお酒"
