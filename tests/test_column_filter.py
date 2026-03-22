from product_register.config.column_filter import load_column_filter, apply_column_filter


def test_apply_column_filter():
    rows = [{"a": "1", "b": "2", "c": "3"}]
    result = apply_column_filter(rows, ["a", "c"])
    assert result == [{"a": "1", "c": "3"}]


def test_apply_column_filter_empty():
    rows = [{"a": "1", "b": "2"}]
    result = apply_column_filter(rows, [])
    assert result == [{}]
