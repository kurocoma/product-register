from pathlib import Path
from product_register.config.master_data import load_maker_codes

CONFIG = Path(__file__).parent.parent / "config" / "master"


def test_load_maker_codes():
    codes = load_maker_codes(CONFIG / "maker_codes.csv")
    assert len(codes) > 0
    # Check a known entry
    assert "t" in codes or "b" in codes  # at least one known maker code exists
