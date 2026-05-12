from conftest import make_product
from product_register.converters.yahoo import YahooConverter, YAHOO_COLUMNS

EXPECTED_85_COLUMNS = [
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


# ===== 既存テスト (移行) =====

def test_yahoo_code():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383", yahoo_path="沖縄のお酒")])
    assert rows[0]["code"] == "t002-2542-1"


def test_yahoo_tax_inclusive_price():
    conv = YahooConverter()
    rows = conv.convert([make_product(selling_price=10000, tax_rate=10, yahoo_category_id="41383")])
    assert rows[0]["price"] == "11000"


def test_yahoo_tax_inclusive_price_8pct():
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


def test_yahoo_85_columns():
    """列数が 85 (旧42から拡張)"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert len(rows[0]) == 85


def test_yahoo_column_order():
    """カラム順が Yahoo 公式アップロードフォーマット (data_input202605122227.csv) と完全一致"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert list(rows[0].keys()) == EXPECTED_85_COLUMNS


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


# ===== 新規テスト: grouping-id =====

def test_yahoo_grouping_id_auto():
    """yahoo_grouping_enabled=True で ne_code 末尾の -数字 を取り除く"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="t002-2542-3", quantity=3,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "t002-2542"


def test_yahoo_grouping_id_double_digit():
    """quantity=10 のような 2 桁数字も正しく trim"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="n019-0250-10", quantity=10,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "n019-0250"


def test_yahoo_grouping_id_disabled():
    """yahoo_grouping_enabled=False のときは grouping-id は空"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=False)])
    assert rows[0]["grouping-id"] == ""


def test_yahoo_grouping_id_S01_preserved():
    """ne_code 末尾が -S01 のように英字を含む場合は trim せず ne_code そのまま"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="t002-2542-S01", quantity=1,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "t002-2542-S01"


# ===== 新規テスト: variation1-* =====

def test_yahoo_variation1_spec_id_always_empty():
    """variation1-spec-id は常に空 (フリータイトル方式)"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=True, yahoo_variation_title="数量")])
    assert rows[0]["variation1-spec-id"] == ""


def test_yahoo_variation1_title():
    """yahoo_variation_title がそのまま variation1-free-title に入る"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=True, yahoo_variation_title="数量")])
    assert rows[0]["variation1-free-title"] == "数量"


def test_yahoo_variation1_name_single():
    """quantity=1, unit='袋' → '1袋'"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        quantity=1, unit="袋",
        yahoo_grouping_enabled=True, yahoo_variation_title="数量",
    )])
    assert rows[0]["variation1-name"] == "1袋"


def test_yahoo_variation1_name_set():
    """quantity=5, unit='袋' → '5袋セット'"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        quantity=5, unit="袋",
        yahoo_grouping_enabled=True, yahoo_variation_title="数量",
    )])
    assert rows[0]["variation1-name"] == "5袋セット"


def test_yahoo_variation1_empty_when_disabled():
    """yahoo_grouping_enabled=False のとき variation1-free-title と -name は空"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=False)])
    assert rows[0]["variation1-free-title"] == ""
    assert rows[0]["variation1-name"] == ""


# ===== 新規テスト: variation2-5 =====

def test_yahoo_variation2_through_5_empty():
    """variation2-5 系 9 列は全て空 (今回スコープ外)"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=True)])
    for n in range(2, 6):
        assert rows[0][f"variation{n}-spec-id"] == ""
        assert rows[0][f"variation{n}-free-title"] == ""
        assert rows[0][f"variation{n}-name"] == ""


# ===== 新規テスト: item-image-urls =====

def test_yahoo_item_image_urls():
    """image_count=3 → 3 URL セミコロン区切り、1枚目はサフィックスなし"""
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=3)])
    urls = rows[0]["item-image-urls"].split(";")
    assert len(urls) == 3
    assert urls[0] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg"
    assert urls[1] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_2.jpg"
    assert urls[2] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_3.jpg"


def test_yahoo_item_image_urls_count_1():
    """image_count=1 → URL 1 件のみ、セミコロンなし"""
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=1)])
    assert rows[0]["item-image-urls"] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg"


def test_yahoo_item_image_urls_count_0():
    """image_count=0 → 空文字列"""
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=0)])
    assert rows[0]["item-image-urls"] == ""


# ===== 新規テスト: 警告ログ =====

def test_yahoo_warns_when_grouping_enabled_but_unit_empty(caplog):
    """yahoo_grouping_enabled=True かつ unit="" の商品があると WARNING ログを出す"""
    import logging
    conv = YahooConverter()
    with caplog.at_level(logging.WARNING):
        rows = conv.convert([make_product(
            ne_code="x999-9999-5", quantity=5, unit="",
            yahoo_grouping_enabled=True, yahoo_variation_title="数量",
        )])
    assert any("unit" in rec.message and "x999-9999-5" in rec.message
               for rec in caplog.records if rec.levelno == logging.WARNING)
    assert rows[0]["variation1-name"] == "5セット"


def test_yahoo_no_warning_when_unit_set(caplog):
    """unit がセットされていれば WARNING は出ない"""
    import logging
    conv = YahooConverter()
    with caplog.at_level(logging.WARNING):
        conv.convert([make_product(
            unit="袋", yahoo_grouping_enabled=True, yahoo_variation_title="数量",
        )])
    assert not any("unit" in rec.message
                   for rec in caplog.records if rec.levelno == logging.WARNING)
