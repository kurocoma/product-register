from pathlib import Path
from product_register.reader import read_input_csv

FIXTURES = Path(__file__).parent / "fixtures"

def test_read_csv_returns_product_list():
    products = read_input_csv(FIXTURES / "input_sample.csv")
    assert len(products) == 3
    assert products[0].ne_code == "t002-2542-1"
    assert products[0].is_single is True

def test_read_csv_set_product():
    products = read_input_csv(FIXTURES / "input_sample.csv")
    set_product = [p for p in products if p.is_set][0]
    assert set_product.quantity == 3

def test_read_csv_empty_optional_fields():
    products = read_input_csv(FIXTURES / "input_sample.csv")
    assert products[0].image_url_20 == ""
