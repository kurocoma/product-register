from pathlib import Path
from product_register.writers.csv_writer import write_csv

def test_write_csv_creates_file(tmp_path):
    rows = [{"col1": "a", "col2": "b"}, {"col1": "c", "col2": "d"}]
    output = tmp_path / "test.csv"
    write_csv(rows, output)
    assert output.exists()
    content = output.read_text(encoding="utf-8-sig")
    assert "col1,col2" in content
    assert "a,b" in content

def test_write_csv_empty_rows(tmp_path):
    output = tmp_path / "empty.csv"
    write_csv([], output)
    assert not output.exists()

def test_write_csv_creates_parent_dirs(tmp_path):
    output = tmp_path / "sub" / "dir" / "test.csv"
    write_csv([{"a": "1"}], output)
    assert output.exists()
