"""
test_integration.py

Integration tests using real data extracted from the Excel template.

These tests verify:
1. Converters produce output with the correct structure (columns, row counts)
2. Output is comparable to expected Excel-based output (differences are logged, not asserted)
"""
import csv
import logging
from pathlib import Path

import pytest

from product_register.reader import read_input_csv
from product_register.converters.rakuten import RakutenConverter
from product_register.converters.ne import NEConverter
from product_register.converters.shopify import ShopifyConverter
from product_register.verify.diff_checker import compare_csv
from product_register.writers.csv_writer import write_csv

FIXTURES = Path(__file__).parent / "fixtures"
EXPECTED = FIXTURES / "expected"

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Structure tests
# ---------------------------------------------------------------------------

def test_rakuten_output_structure(tmp_path):
    """楽天CSV出力の構造テスト（行数・主要カラム存在確認）"""
    products = read_input_csv(FIXTURES / "input_sample.csv")
    rows = RakutenConverter().convert(products)
    assert len(rows) > 0
    assert "商品管理番号（商品URL）" in rows[0]
    assert "属性" in rows[0]


def test_ne_output_structure(tmp_path):
    """NE CSV出力の構造テスト"""
    products = read_input_csv(FIXTURES / "input_sample.csv")
    singles, sets = NEConverter().convert(products)
    assert len(singles) + len(sets) == len(products)
    if singles:
        assert "syohin_code" in singles[0]
    if sets:
        # NE converter uses syohin_code key for both singles and sets
        assert "syohin_code" in sets[0]


def test_shopify_output_structure(tmp_path):
    """Shopify CSV出力の構造テスト"""
    products = read_input_csv(FIXTURES / "input_sample.csv")
    rows = ShopifyConverter().convert(products)
    # At minimum, one row per product
    assert len(rows) >= len(products)
    assert "Handle" in rows[0]
    assert "Image Src" in rows[0]


# ---------------------------------------------------------------------------
# Diff tests (differences are EXPECTED initially — logged, not asserted as zero)
# ---------------------------------------------------------------------------

def test_rakuten_diff_vs_expected(tmp_path):
    """楽天出力をExcel期待値と比較。差分はログ出力のみ（アサートなし）"""
    expected_path = EXPECTED / "rakuten_normal_item.csv"
    if not expected_path.exists():
        pytest.skip("Expected file not found: run scripts/extract_test_data.py first")

    products = read_input_csv(FIXTURES / "input_sample.csv")
    rows = RakutenConverter().convert(products)
    actual_path = tmp_path / "rakuten_actual.csv"
    write_csv(rows, actual_path)

    result = compare_csv(actual_path, expected_path, key_column="商品管理番号（商品URL）", mall="rakuten")
    _log_diff_result(result, "rakuten")

    # Structural assertion: actual must have rows
    assert len(rows) > 0, "Rakuten converter produced no output"


def test_ne_single_diff_vs_expected(tmp_path):
    """NE単品出力をExcel期待値と比較。差分はログ出力のみ"""
    expected_path = EXPECTED / "ne_single.csv"
    if not expected_path.exists():
        pytest.skip("Expected file not found: run scripts/extract_test_data.py first")

    products = read_input_csv(FIXTURES / "input_sample.csv")
    singles, _ = NEConverter().convert(products)

    if not singles:
        pytest.skip("No single products in input_sample.csv")

    actual_path = tmp_path / "ne_single_actual.csv"
    write_csv(singles, actual_path)

    result = compare_csv(actual_path, expected_path, key_column="syohin_code", mall="ne")
    _log_diff_result(result, "ne_single")

    assert len(singles) > 0, "NE single converter produced no output"


def test_ne_set_diff_vs_expected(tmp_path):
    """NEセット商品出力をExcel期待値と比較。差分はログ出力のみ"""
    expected_path = EXPECTED / "ne_set.csv"
    if not expected_path.exists():
        pytest.skip("Expected file not found: run scripts/extract_test_data.py first")

    products = read_input_csv(FIXTURES / "input_sample.csv")
    _, sets = NEConverter().convert(products)

    if not sets:
        pytest.skip("No set products in input_sample.csv")

    actual_path = tmp_path / "ne_set_actual.csv"
    write_csv(sets, actual_path)

    result = compare_csv(actual_path, expected_path, key_column="set_syohin_code", mall="ne")
    _log_diff_result(result, "ne_set")

    assert len(sets) > 0, "NE set converter produced no output"


def test_shopify_diff_vs_expected(tmp_path):
    """Shopify出力をExcel期待値と比較。差分はログ出力のみ"""
    expected_path = EXPECTED / "shopify.csv"
    if not expected_path.exists():
        pytest.skip("Expected file not found: run scripts/extract_test_data.py first")

    products = read_input_csv(FIXTURES / "input_sample.csv")
    rows = ShopifyConverter().convert(products)
    actual_path = tmp_path / "shopify_actual.csv"
    write_csv(rows, actual_path)

    result = compare_csv(actual_path, expected_path, key_column=["Handle", "Image Position"], mall="shopify")
    _log_diff_result(result, "shopify")

    assert len(rows) > 0, "Shopify converter produced no output"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log_diff_result(result: dict, label: str) -> None:
    """Log diff comparison results without raising on mismatches."""
    summary = result["summary"]
    logger.info(
        "[%s] total=%d matched=%d mismatched=%d missing=%d extra=%d",
        label,
        summary["total_rows"],
        summary["matched_rows"],
        summary["mismatched_rows"],
        summary["missing_rows"],
        summary["extra_rows"],
    )
    for mm in result.get("mismatches", []):
        for diff in mm.get("diffs", []):
            logger.warning(
                "[%s] row=%s col=%r | expected=%r | actual=%r | hint=%s",
                label,
                mm["product_code"],
                diff["column"],
                diff["expected"],
                diff["actual"],
                diff.get("hint", ""),
            )
    if result.get("missing_keys"):
        logger.warning("[%s] missing keys: %s", label, result["missing_keys"])
    if result.get("extra_keys"):
        logger.warning("[%s] extra keys: %s", label, result["extra_keys"])
