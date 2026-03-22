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
