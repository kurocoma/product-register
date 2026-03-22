from conftest import make_product
from product_register.converters.rakuten import RakutenConverter

def test_single_product_is_parent():
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["属性"] == "親"

def test_set_product_is_child():
    conv = RakutenConverter()
    rows = conv.convert([make_product(product_type="セット商品", ne_code="t002-2542-3", quantity=3)])
    assert rows[0]["属性"] == "子"

def test_tax_rate_conversion():
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["消費税率"] == "0.1"

def test_manage_number_generation():
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["商品管理番号（商品URL）"] == "t002-2542-1"

def test_parent_child_sort_order():
    conv = RakutenConverter()
    products = [
        make_product(ne_code="t002-2542-3", product_type="セット商品", quantity=3),
        make_product(ne_code="t002-2542-1"),
    ]
    rows = conv.convert(products)
    assert rows[0]["商品管理番号（商品URL）"] == "t002-2542-1"
    assert rows[0]["属性"] == "親"

def test_attribute_unit_zero_to_null():
    conv = RakutenConverter()
    rows = conv.convert([make_product(attribute_unit_1="0")])
    assert rows[0].get("商品属性（単位）1", "") == ""
