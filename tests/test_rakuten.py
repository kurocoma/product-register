from conftest import make_product
from product_register.converters.rakuten import RakutenConverter


def test_base_code_as_manage_number():
    """商品管理番号（商品URL）は base_code (maker_code + JAN下4桁) になること"""
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    # First row is the parent row
    assert rows[0]["商品管理番号（商品URL）"] == "t002-2542"


def test_parent_row_has_shohin_bangou():
    """親行は商品番号 = base_code を持つこと"""
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    parent = rows[0]
    assert parent["商品番号"] == "t002-2542"
    assert parent["商品名"] == "巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度"


def test_child_row_has_sku_manage_number():
    """子行は SKU管理番号 = ne_code を持つこと"""
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    child = rows[1]
    assert child["SKU管理番号"] == "t002-2542-1"
    assert child["システム連携用SKU番号"] == "t002-2542-1"


def test_grouping_single_and_set_under_same_base():
    """同じ base_code の単品とセット商品は1つの親行にまとまること"""
    conv = RakutenConverter()
    products = [
        make_product(ne_code="t002-2542-1", product_type="単品", quantity=1),
        make_product(ne_code="t002-2542-3", product_type="セット商品", quantity=3),
    ]
    rows = conv.convert(products)
    # 1 parent + 2 children = 3 rows total
    assert len(rows) == 3
    manage_numbers = [r["商品管理番号（商品URL）"] for r in rows]
    assert all(m == "t002-2542" for m in manage_numbers)


def test_parent_child_order():
    """グループ内では親行が子行より先に出ること"""
    conv = RakutenConverter()
    products = [
        make_product(ne_code="t002-2542-3", product_type="セット商品", quantity=3),
        make_product(ne_code="t002-2542-1", product_type="単品", quantity=1),
    ]
    rows = conv.convert(products)
    parent = rows[0]
    assert parent["商品番号"] == "t002-2542"


def test_tax_rate_conversion():
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    assert rows[0]["消費税率"] == "0.1"


def test_child_variation_key_and_choice():
    """子行のバリエーション選択肢は option_item_name から取得されること"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(variation_key="key0", option_item_name="1本")])
    child = rows[1]
    assert child["バリエーション項目キー1"] == "key0"
    assert child["バリエーション項目選択肢1"] == "1本"


def test_parent_variation_definition():
    """親行のバリエーション定義フィールドが設定されること"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(
        variation_key="key0",
        variation_name="本数",
        variation_choices="1本|3本",
    )])
    parent = rows[0]
    assert parent["バリエーション項目キー定義"] == "key0"
    assert parent["バリエーション項目名定義"] == "本数"
    assert parent["バリエーション1選択肢定義"] == "1本|3本"


def test_child_price():
    """子行の販売価格・表示価格が selling_price から設定されること"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(selling_price=10000)])
    child = rows[1]
    assert child["販売価格"] == "10000"
    assert child["表示価格"] == "10000"


def test_attribute_unit_zero_to_null():
    conv = RakutenConverter()
    rows = conv.convert([make_product(attribute_unit_1="0")])
    # Child row contains the attribute fields
    child = rows[1]
    assert child.get("商品属性（単位）1", "") == ""


def test_multiple_groups_sorted():
    """複数グループは base_code 昇順で出力されること"""
    conv = RakutenConverter()
    products = [
        make_product(ne_code="t002-2559-1", jan_code="4955028002559",
                     product_type="単品", quantity=1),
        make_product(ne_code="t002-2542-1", jan_code="4955028002542",
                     product_type="単品", quantity=1),
    ]
    rows = conv.convert(products)
    # t002-2542 should come before t002-2559
    assert rows[0]["商品管理番号（商品URL）"] == "t002-2542"
    assert rows[2]["商品管理番号（商品URL）"] == "t002-2559"


def test_parent_image_paths():
    """親行の商品画像パスは CABINET 形式のパスであること"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(image_count=3)])
    parent = rows[0]
    assert parent["商品画像タイプ1"] == "CABINET"
    assert parent["商品画像パス1"] == "/thum02/t002-2542-1.jpg"
    assert parent["商品画像パス2"] == "/thum02/t002-2542_2.jpg"
    assert parent["商品画像パス3"] == "/thum02/t002-2542_3.jpg"


def test_child_sku_image():
    """子行の SKU画像パスは CABINET + ne_code パスであること"""
    conv = RakutenConverter()
    rows = conv.convert([make_product()])
    child = rows[1]
    assert child["SKU画像タイプ"] == "CABINET"
    assert child["SKU画像パス"] == "/thum02/t002-2542-1.jpg"


def test_parent_pc_description_no_imglist():
    """PC用商品説明文には imgList を入れない (description_pc そのまま)"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(image_count=3, description_pc="本文テキスト")])
    parent = rows[0]
    assert parent["PC用商品説明文"] == "本文テキスト"
    assert "<!--imgList-->" not in parent["PC用商品説明文"]


def test_parent_sp_description_imglist_then_text():
    """スマートフォン用商品説明文は imgList が先、その後 description_sp"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(image_count=3, description_sp="SP本文")])
    parent = rows[0]
    desc = parent["スマートフォン用商品説明文"]
    assert desc.startswith("<!--imgList-->"), f"先頭が imgList でない: {desc[:50]}"
    assert "<!--/imgList-->" in desc
    assert "image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/t002-2542_2.jpg" in desc
    assert "image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/t002-2542_3.jpg" in desc
    assert desc.endswith("SP本文")


def test_parent_pc_sale_description_imglist_only():
    """PC用販売説明文は imgList のみ (description_sp を含めない)"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(image_count=3, description_sp="SP本文")])
    parent = rows[0]
    desc = parent["PC用販売説明文"]
    assert "<!--imgList-->" in desc
    assert "<!--/imgList-->" in desc
    assert "SP本文" not in desc, "PC用販売説明文には本文を含めない"


def test_parent_imglist_image_count_1():
    """image_count=1 のとき imgList は空 (2枚目以降がない)"""
    conv = RakutenConverter()
    rows = conv.convert([make_product(image_count=1, description_sp="SP本文")])
    parent = rows[0]
    assert parent["スマートフォン用商品説明文"] == "SP本文"
    assert parent["PC用販売説明文"] == ""
