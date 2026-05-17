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
    assert row["sire_code"] == "002"

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

def test_ne_single_daihyo_syohin_code_empty():
    """単品の daihyo_syohin_code は空文字列であること"""
    conv = NEConverter()
    singles, _ = conv.convert([make_product()])
    row = singles[0]
    assert row["daihyo_syohin_code"] == ""

def test_ne_single_sire_code_digits_only():
    """sire_code は maker_code の数字部分のみ"""
    conv = NEConverter()
    singles, _ = conv.convert([make_product(maker_code="t002")])
    assert singles[0]["sire_code"] == "002"
    singles2, _ = conv.convert([make_product(maker_code="n019")])
    assert singles2[0]["sire_code"] == "019"

def test_ne_single_image_url_auto_generated():
    """image_url_1 が未設定の場合、Rakuten 画像 URL を自動生成する"""
    conv = NEConverter()
    singles, _ = conv.convert([make_product(image_url_1="")])
    row = singles[0]
    assert row["image_url_http"] == "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/t002-2542-1.jpg"

def test_ne_set_format():
    """セット商品は set_ プレフィックスのフィールドを持つ"""
    conv = NEConverter()
    _, sets = conv.convert([make_product(product_type="セット商品", ne_code="t002-2542-3", quantity=3, selling_price=30000)])
    row = sets[0]
    assert row["set_syohin_code"] == "t002-2542-3"
    assert row["syohin_code"] == "t002-2542-1"
    assert row["suryo"] == "3"
    assert row["set_baika_tnk"] == "30000"
    assert "sire_code" not in row

def test_ne_set_daihyo_syohin_code_empty():
    """セット商品の daihyo_syohin_code は空文字列であること"""
    conv = NEConverter()
    _, sets = conv.convert([make_product(product_type="セット商品", ne_code="t002-2542-3", quantity=3)])
    assert sets[0]["daihyo_syohin_code"] == ""


def test_ne_set_no_buffer_function_column():
    """セット商品 CSV に 'バッファ関数1' 列が含まれていないこと (NE 取込で警告が出る非対応列)"""
    conv = NEConverter()
    _, sets = conv.convert([make_product(product_type="セット商品", ne_code="t002-2542-3", quantity=3)])
    assert "バッファ関数1" not in sets[0], "バッファ関数1 列は NE 仕様外なので出力されるべきでない"
