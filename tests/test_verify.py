import json
from pathlib import Path
from product_register.verify.diff_checker import compare_csv
from product_register.verify.reporter import generate_report

def test_compare_identical_csv(tmp_path):
    csv_content = "col1,col2\nA,B\nC,D\n"
    (tmp_path / "actual.csv").write_text(csv_content, encoding="utf-8-sig")
    (tmp_path / "expected.csv").write_text(csv_content, encoding="utf-8-sig")
    result = compare_csv(tmp_path / "actual.csv", tmp_path / "expected.csv", key_column="col1")
    assert result["summary"]["mismatched_rows"] == 0

def test_compare_detects_value_diff(tmp_path):
    (tmp_path / "actual.csv").write_text("code,price\nA,100\n", encoding="utf-8-sig")
    (tmp_path / "expected.csv").write_text("code,price\nA,200\n", encoding="utf-8-sig")
    result = compare_csv(tmp_path / "actual.csv", tmp_path / "expected.csv", key_column="code")
    assert result["summary"]["mismatched_rows"] == 1
    assert result["mismatches"][0]["diffs"][0]["column"] == "price"
    assert result["mismatches"][0]["diffs"][0]["expected"] == "200"
    assert result["mismatches"][0]["diffs"][0]["actual"] == "100"

def test_compare_detects_missing_rows(tmp_path):
    (tmp_path / "actual.csv").write_text("code,price\nA,100\n", encoding="utf-8-sig")
    (tmp_path / "expected.csv").write_text("code,price\nA,100\nB,200\n", encoding="utf-8-sig")
    result = compare_csv(tmp_path / "actual.csv", tmp_path / "expected.csv", key_column="code")
    assert result["summary"]["missing_rows"] == 1

def test_compare_composite_key(tmp_path):
    actual = "Handle,Image Position,Title\nA,1,Product A\nA,2,\n"
    expected = "Handle,Image Position,Title\nA,1,Product A\nA,2,\n"
    (tmp_path / "actual.csv").write_text(actual, encoding="utf-8-sig")
    (tmp_path / "expected.csv").write_text(expected, encoding="utf-8-sig")
    result = compare_csv(tmp_path / "actual.csv", tmp_path / "expected.csv",
                         key_column=["Handle", "Image Position"])
    assert result["summary"]["matched_rows"] == 2
    assert result["summary"]["mismatched_rows"] == 0

def test_report_generates_json(tmp_path):
    result = {
        "mall": "rakuten",
        "summary": {"total_rows": 1, "matched_rows": 0, "mismatched_rows": 1,
                     "missing_rows": 0, "extra_rows": 0},
        "mismatches": [{"row": 1, "product_code": "A",
                        "diffs": [{"column": "price", "expected": "200", "actual": "100"}]}]
    }
    log_path = tmp_path / "verify.json"
    generate_report(result, log_path)
    loaded = json.loads(log_path.read_text(encoding="utf-8"))
    assert loaded["mall"] == "rakuten"
