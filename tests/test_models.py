import pytest
from product_register.models import ProductInput

def test_valid_single_product():
    p = ProductInput(
        ne_code="t002-2542-1",
        jan_code="4955028002542",
        maker_code="t002",
        product_type="単品",
        quantity=1,
        product_name="GIANTSボトル 10年貯蔵古酒 720ml 25度",
        display_name="巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
        tax_rate=10,
        selling_price=10000,
        shipping_type="送料無料",
        image_count=7,
        delivery_method=4,
        lead_time=1,
        mall_category_id="402930",
    )
    assert p.ne_code == "t002-2542-1"
    assert p.is_single is True
    assert p.is_set is False

def test_valid_set_product():
    p = ProductInput(
        ne_code="t002-2542-3",
        jan_code="4955028002542",
        maker_code="t002",
        product_type="セット商品",
        quantity=3,
        product_name="GIANTSボトル 10年貯蔵古酒 720ml 25度",
        display_name="巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
        tax_rate=10,
        selling_price=30000,
        shipping_type="送料無料",
        image_count=7,
        delivery_method=4,
        lead_time=1,
        mall_category_id="402930",
    )
    assert p.is_single is False
    assert p.is_set is True

def test_mixed_set_product_code():
    """異種セット商品: S01形式"""
    p = ProductInput(
        ne_code="t002-2542-S01",
        jan_code="4955028002542",
        maker_code="t002",
        product_type="セット商品",
        quantity=1,
        product_name="セット商品A",
        display_name="セット商品A",
        tax_rate=10,
        selling_price=15000,
        shipping_type="送料無料",
        image_count=3,
        delivery_method=4,
        lead_time=1,
        mall_category_id="402930",
    )
    assert p.is_set is True

def test_invalid_tax_rate():
    with pytest.raises(Exception):
        ProductInput(
            ne_code="x001-0001-1",
            jan_code="1234567890123",
            maker_code="x001",
            product_type="単品",
            quantity=1,
            product_name="テスト",
            display_name="テスト",
            tax_rate=15,
            selling_price=100,
            shipping_type="送料別",
            image_count=1,
            delivery_method=4,
            lead_time=1,
            mall_category_id="000000",
        )

def test_jan_code_must_be_13_digits():
    with pytest.raises(Exception):
        ProductInput(
            ne_code="x001-0001-1",
            jan_code="12345",
            maker_code="x001",
            product_type="単品",
            quantity=1,
            product_name="テスト",
            display_name="テスト",
            tax_rate=10,
            selling_price=100,
            shipping_type="送料別",
            image_count=1,
            delivery_method=4,
            lead_time=1,
            mall_category_id="000000",
        )


def test_yahoo_grouping_fields_default():
    """新規追加フィールドはデフォルト値ありで optional"""
    p = ProductInput(
        ne_code="t002-2542-1", jan_code="4955028002542", maker_code="t002",
        product_type="単品", quantity=1,
        product_name="テスト", display_name="テスト",
        tax_rate=10, selling_price=100,
        shipping_type="送料別", image_count=1, delivery_method=4,
        lead_time=1, mall_category_id="000000",
    )
    assert p.unit == ""
    assert p.yahoo_grouping_enabled is False
    assert p.yahoo_variation_title == ""


def test_yahoo_grouping_fields_explicit():
    """値を明示するとそのまま入る"""
    p = ProductInput(
        ne_code="n019-0250-5", jan_code="4522814010250", maker_code="n019",
        product_type="セット商品", quantity=5,
        product_name="テスト", display_name="テスト",
        tax_rate=8, selling_price=4000,
        shipping_type="送料無料", image_count=8, delivery_method=4,
        lead_time=1, mall_category_id="564651",
        unit="袋",
        yahoo_grouping_enabled=True,
        yahoo_variation_title="数量",
    )
    assert p.unit == "袋"
    assert p.yahoo_grouping_enabled is True
    assert p.yahoo_variation_title == "数量"
