import pytest
from product_register.converters.base import BaseConverter

def test_base_converter_is_abstract():
    with pytest.raises(TypeError):
        BaseConverter()

def test_subclass_must_implement_convert():
    class Dummy(BaseConverter):
        mall_name = "dummy"
        def convert(self, products):
            return [{"col1": "val1"}]
    d = Dummy()
    assert d.mall_name == "dummy"
    result = d.convert([])
    assert result == [{"col1": "val1"}]


def test_base_converter_default_encoding():
    """BaseConverter の encoding デフォルトは utf-8-sig"""
    class Dummy(BaseConverter):
        mall_name = "dummy"
        def convert(self, products):
            return []
    assert Dummy.encoding == "utf-8-sig"


def test_rakuten_encoding_is_cp932():
    """RakutenConverter は cp932 (Windows 拡張 Shift_JIS) で出力。
    RMS は Shift_JIS を要求するが、全角チルダ等の機種依存文字を含むため cp932 を採用。"""
    from product_register.converters.rakuten import RakutenConverter
    assert RakutenConverter.encoding == "cp932"


def test_ne_encoding_is_utf8_no_bom():
    """NEConverter は BOM なし UTF-8 で出力する (列名 BOM 混入を防ぐ)"""
    from product_register.converters.ne import NEConverter
    assert NEConverter.encoding == "utf-8"


def test_yahoo_encoding_is_cp932():
    """YahooConverter は cp932 (Yahoo 公式アップロードフォーマットに合わせる)"""
    from product_register.converters.yahoo import YahooConverter
    assert YahooConverter.encoding == "cp932"


def test_shopify_encoding_is_utf8_bom():
    """ShopifyConverter は BOM 付き UTF-8 (utf-8-sig) で出力 (デフォルト)"""
    from product_register.converters.shopify import ShopifyConverter
    assert ShopifyConverter.encoding == "utf-8-sig"
