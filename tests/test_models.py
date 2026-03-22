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
