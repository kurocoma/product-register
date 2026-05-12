from pathlib import Path
from product_register.reader import read_input_csv

FIXTURES = Path(__file__).parent / "fixtures"

def test_read_csv_returns_product_list():
    products = read_input_csv(FIXTURES / "input_sample.csv")
    # input_sample.csv contains 5 real products from the Excel template
    assert len(products) >= 3
    assert products[0].ne_code == "t002-2542-1"
    assert products[0].is_single is True

def test_read_csv_set_product():
    products = read_input_csv(FIXTURES / "input_sample.csv")
    set_product = [p for p in products if p.is_set][0]
    assert set_product.quantity == 3

def test_read_csv_optional_fields_are_strings():
    """Optional string fields should be present (may be empty or have values)."""
    products = read_input_csv(FIXTURES / "input_sample.csv")
    # image_url fields should be strings (empty or URL)
    assert isinstance(products[0].image_url_1, str)
    assert isinstance(products[0].image_url_20, str)


def test_parse_bool_true_variants():
    """CSV値 'TRUE' / 'True' / 'true' / '1' / 'YES' を bool True に変換"""
    from product_register.reader import _parse_bool
    assert _parse_bool("TRUE") is True
    assert _parse_bool("True") is True
    assert _parse_bool("true") is True
    assert _parse_bool("1") is True
    assert _parse_bool("YES") is True


def test_parse_bool_false_variants():
    """CSV値 'FALSE' / 'false' / '0' / '' / 認識外文字列は False"""
    from product_register.reader import _parse_bool
    assert _parse_bool("FALSE") is False
    assert _parse_bool("false") is False
    assert _parse_bool("0") is False
    assert _parse_bool("") is False
    assert _parse_bool("NO") is False


def test_read_csv_yahoo_grouping_enabled(tmp_path):
    """CSV の yahoo_grouping_enabled 列を bool に変換して ProductInput を構築"""
    csv_content = (
        "ne_code,jan_code,maker_code,product_type,quantity,product_name,display_name,"
        "tax_rate,cost_price,selling_price,shipping_type,image_count,delivery_method,"
        "lead_time,mall_category_id,unit,yahoo_grouping_enabled,yahoo_variation_title\n"
        "t002-2542-1,4955028002542,t002,単品,1,テスト,テスト,10,0,100,送料別,1,4,1,000000,"
        "本,TRUE,数量\n"
        "t002-2542-3,4955028002542,t002,セット商品,3,テスト,テスト,10,0,300,送料別,1,4,1,000000,"
        "本,FALSE,\n"
    )
    csv_path = tmp_path / "input.csv"
    csv_path.write_text(csv_content, encoding="utf-8-sig")
    products = read_input_csv(csv_path)
    assert products[0].yahoo_grouping_enabled is True
    assert products[1].yahoo_grouping_enabled is False


def test_read_csv_backward_compat(tmp_path):
    """既存 CSV (3 列未追加) でも ProductInput が構築できる (後方互換)"""
    csv_content = (
        "ne_code,jan_code,maker_code,product_type,quantity,product_name,display_name,"
        "tax_rate,cost_price,selling_price,shipping_type,image_count,delivery_method,"
        "lead_time,mall_category_id\n"
        "t002-2542-1,4955028002542,t002,単品,1,テスト,テスト,10,0,100,送料別,1,4,1,000000\n"
    )
    csv_path = tmp_path / "input.csv"
    csv_path.write_text(csv_content, encoding="utf-8-sig")
    products = read_input_csv(csv_path)
    assert products[0].unit == ""
    assert products[0].yahoo_grouping_enabled is False
    assert products[0].yahoo_variation_title == ""
