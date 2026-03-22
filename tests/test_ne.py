from conftest import make_product
from product_register.converters.ne import NEConverter

def test_ne_outputs_two_lists():
    conv = NEConverter()
    products = [
        make_product(),
        make_product(ne_code="t002-2542-3", product_type="セット商品", quantity=3),
    ]
    singles, sets = conv.convert(products)
    assert len(singles) == 1
    assert len(sets) == 1

def test_ne_field_mapping():
    conv = NEConverter()
    singles, _ = conv.convert([make_product()])
    row = singles[0]
    assert row["syohin_code"] == "t002-2542-1"
    assert row["syohin_name"] == "GIANTSボトル 10年貯蔵古酒 720ml 25度"
    assert row["baika_tnk"] == "10000"
    assert row["jan_code"] == "4955028002542"
    assert row["sire_code"] == "t002"

def test_ne_required_fields_present():
    conv = NEConverter()
    singles, _ = conv.convert([make_product()])
    row = singles[0]
    for field in ["syohin_code", "sire_code", "syohin_name", "genka_tnk", "baika_tnk"]:
        assert field in row, f"Missing required field: {field}"

def test_ne_single_only():
    conv = NEConverter()
    singles, sets = conv.convert([make_product()])
    assert len(singles) == 1
    assert len(sets) == 0

def test_ne_set_only():
    conv = NEConverter()
    singles, sets = conv.convert([make_product(product_type="セット商品", ne_code="t002-2542-3", quantity=3)])
    assert len(singles) == 0
    assert len(sets) == 1
