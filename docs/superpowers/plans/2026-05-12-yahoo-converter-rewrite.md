# Yahoo Converter 再書き直し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yahoo Converter を 42 列 → 85 列の正規アップロードフォーマットに移行し、`grouping-id` + `variation1-*` で同一 JAN の単品/セット商品を 1 ページに集約する。

**Architecture:** 1) `ProductInput` に `unit` / `yahoo_grouping_enabled` / `yahoo_variation_title` の 3 列を追加。 2) `reader.py` に CSV→bool 変換ヘルパーを追加。 3) `YahooConverter` を 85 列対応に書き直し、3 つのヘルパー関数 (`_resolve_grouping_id` / `_build_variation_name` / `_build_item_image_urls`) で値を生成。 4) テスト・期待値 CSV を更新。

**Tech Stack:** Python 3.13, Pydantic v2, pytest, click

**仕様書:** [docs/superpowers/specs/2026-05-12-yahoo-converter-rewrite-design.md](../specs/2026-05-12-yahoo-converter-rewrite-design.md)

**参照:** [docs/Yahoo/data_input202605122227.csv](../../Yahoo/data_input202605122227.csv) (85列リファレンス, cp932)

---

## ファイル構成

| 状態 | パス | 役割 |
|---|---|---|
| Modify | [src/product_register/models.py](../../../src/product_register/models.py) | `ProductInput` に 3 列追加 |
| Modify | [src/product_register/reader.py](../../../src/product_register/reader.py) | `_parse_bool` ヘルパーと bool フィールド変換ロジック追加 |
| Rewrite | [src/product_register/converters/yahoo.py](../../../src/product_register/converters/yahoo.py) | 85 列対応に全面書き換え |
| Modify | [tests/conftest.py](../../../tests/conftest.py) | `make_product` のデフォルトに 3 列追加 |
| Modify | [tests/test_yahoo.py](../../../tests/test_yahoo.py) | 既存 13 件中 1 件リネーム、新規 14 件追加 |
| Modify | [tests/test_reader.py](../../../tests/test_reader.py) | 新規 4 件追加 |
| Modify | [tests/test_models.py](../../../tests/test_models.py) | 新規フィールドのバリデーションテスト追加 |
| Modify | [tests/test_integration.py](../../../tests/test_integration.py) | `test_yahoo_grouping_consistency` 追加 |
| Modify | [tests/fixtures/input_sample.csv](../../../tests/fixtures/input_sample.csv) | 7 行全てに 3 列追加 |
| Regen | [tests/fixtures/expected/yahoo.csv](../../../tests/fixtures/expected/yahoo.csv) | 7 商品 × 85 列に再生成 |

---

## Task 1: ProductInput に 3 列追加

**Files:**
- Modify: `src/product_register/models.py`
- Modify: `tests/test_models.py`

- [ ] **Step 1: 失敗テストを書く**

`tests/test_models.py` の末尾に以下を追記:

```python
def test_yahoo_grouping_fields_default():
    """新規追加フィールドはデフォルト値ありで optional"""
    p = ProductInput(
        ne_code="t002-2542-1", jan_code="4955028002542", maker_code="t002",
        product_type="単品", quantity=1,
        product_name="テスト", display_name="テスト",
        tax_rate=10, selling_price=100,
        shipping_type="送料別", image_count=1, delivery_method=4,
        lead_time=1, mall_category_id="000000",
    )
    assert p.unit == ""
    assert p.yahoo_grouping_enabled is False
    assert p.yahoo_variation_title == ""


def test_yahoo_grouping_fields_explicit():
    """値を明示するとそのまま入る"""
    p = ProductInput(
        ne_code="n019-0250-5", jan_code="4522814010250", maker_code="n019",
        product_type="セット商品", quantity=5,
        product_name="テスト", display_name="テスト",
        tax_rate=8, selling_price=4000,
        shipping_type="送料無料", image_count=8, delivery_method=4,
        lead_time=1, mall_category_id="564651",
        unit="袋",
        yahoo_grouping_enabled=True,
        yahoo_variation_title="数量",
    )
    assert p.unit == "袋"
    assert p.yahoo_grouping_enabled is True
    assert p.yahoo_variation_title == "数量"
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `pytest tests/test_models.py -v -k yahoo_grouping`
Expected: FAIL（`unit` フィールドが存在しない）

- [ ] **Step 3: models.py に 3 列追加**

`src/product_register/models.py` の `brand_name: str = ""` の直後（既存 Yahoo 固有フィールドの直前）に挿入:

```python
    # Yahoo セット集約用 (新規追加)
    unit: str = ""                        # 単位 (例: "本", "袋", "個", "枚")
    yahoo_grouping_enabled: bool = False  # grouping を有効にするか
    yahoo_variation_title: str = ""       # variation1-free-title (例: "数量")
```

- [ ] **Step 4: テスト実行 → 成功確認**

Run: `pytest tests/test_models.py -v`
Expected: ALL PASS (既存 + 新規 2 件)

- [ ] **Step 5: コミット**

```bash
git add src/product_register/models.py tests/test_models.py
git commit -m "feat: ProductInput に Yahoo grouping 用 3 列追加 (unit, yahoo_grouping_enabled, yahoo_variation_title)"
```

---

## Task 2: reader.py に bool 変換ロジック追加

**Files:**
- Modify: `src/product_register/reader.py`
- Modify: `tests/test_reader.py`

- [ ] **Step 1: 失敗テストを書く**

`tests/test_reader.py` の末尾に以下を追記:

```python
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
    from product_register.reader import read_input_csv
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
    from product_register.reader import read_input_csv
    products = read_input_csv(csv_path)
    # Pydantic デフォルトが効く
    assert products[0].unit == ""
    assert products[0].yahoo_grouping_enabled is False
    assert products[0].yahoo_variation_title == ""
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `pytest tests/test_reader.py -v -k "parse_bool or yahoo_grouping or backward_compat"`
Expected: FAIL（`_parse_bool` が存在しない）

- [ ] **Step 3: reader.py に最小差分パッチを当てる**

`src/product_register/reader.py` への変更は **`_parse_bool` 追加 + 既存ループに bool 変換追加** のみ。`read_input_excel` 等のスコープ外関数は追加しない。

`from product_register.models import ProductInput` の直後に `_parse_bool` を追加:

```python
def _parse_bool(v: str) -> bool:
    """CSV の文字列を bool に変換。空文字列は False。"""
    if not v:
        return False
    return v.strip().upper() in ("TRUE", "1", "YES")
```

そして `read_input_csv` 内の `# 数値フィールドの変換` の **for ループの直後**（`products.append(...)` の直前）に bool 変換ループを追加:

```python
            # bool フィールドの変換
            for bool_field in ("yahoo_grouping_enabled",):
                if bool_field in cleaned:
                    cleaned[bool_field] = _parse_bool(cleaned[bool_field])
```

- [ ] **Step 4: テスト実行 → 成功確認**

Run: `pytest tests/test_reader.py -v`
Expected: ALL PASS（既存 + 新規 4 件）

- [ ] **Step 5: コミット**

```bash
git add src/product_register/reader.py tests/test_reader.py
git commit -m "feat: reader に bool 変換ロジック追加 (_parse_bool + yahoo_grouping_enabled 対応)"
```

---

## Task 3: conftest.py 更新 + input_sample.csv 拡張

**Files:**
- Modify: `tests/conftest.py`
- Modify: `tests/fixtures/input_sample.csv`

> **注意:** input_sample.csv は 3903 行（HTML 改行込みで 7 商品）あるため、Python スクリプトで列追加するのが安全。

- [ ] **Step 1: conftest.py の `make_product` デフォルトを更新**

`tests/conftest.py` の `defaults = dict(...)` の末尾、`catch_copy_yahoo="毎年完売 プロ野球ボトル",` の **直後** に 3 行追加する。

Edit ツールで以下の `old_string` → `new_string` を適用:

`old_string`:
```python
        catch_copy_pc="毎年完売必須 プロ野球 人気のボトル",
        catch_copy_yahoo="毎年完売 プロ野球ボトル",
    )
```

`new_string`:
```python
        catch_copy_pc="毎年完売必須 プロ野球 人気のボトル",
        catch_copy_yahoo="毎年完売 プロ野球ボトル",
        unit="本",
        yahoo_grouping_enabled=False,
        yahoo_variation_title="数量",
    )
```

> ⚠ `yahoo_grouping_enabled=False` をデフォルトにする理由: 既存テストの出力が変わらないようにするため。grouping を検証するテストは個別に `make_product(yahoo_grouping_enabled=True, ...)` で明示する。

- [ ] **Step 2: input_sample.csv に 3 列追加するスクリプトを書く（一時利用）**

`scripts/_add_yahoo_grouping_columns.py` を作成（このスクリプトは Task 3 後に削除）:

```python
"""input_sample.csv に Yahoo grouping 用 3 列を追加する一時スクリプト。
実行後はこのファイルを削除すること。"""
import csv
from pathlib import Path

# 商品ごとの unit マッピング
UNIT_BY_MAKER = {
    "t002": "本",  # 泡盛
    "n019": "袋",  # ちんすこう
}

src = Path("tests/fixtures/input_sample.csv")
dst = src

with open(src, encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))
    fieldnames = list(rows[0].keys())

# 既に追加済みならスキップ
if "unit" in fieldnames:
    print("Already has columns, skipping.")
    raise SystemExit(0)

fieldnames += ["unit", "yahoo_grouping_enabled", "yahoo_variation_title"]

for r in rows:
    maker = r.get("maker_code", "")
    r["unit"] = UNIT_BY_MAKER.get(maker, "個")
    r["yahoo_grouping_enabled"] = "TRUE"
    r["yahoo_variation_title"] = "数量"

with open(dst, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print(f"Updated {dst} with 3 new columns × {len(rows)} rows")
```

- [ ] **Step 3: スクリプトを実行**

Run: `python scripts/_add_yahoo_grouping_columns.py`
Expected: `Updated tests/fixtures/input_sample.csv with 3 new columns × 7 rows`

- [ ] **Step 4: スクリプトを削除**

```bash
rm scripts/_add_yahoo_grouping_columns.py
```

- [ ] **Step 5: 既存テストが壊れていないか確認**

Run: `pytest tests/ -v --tb=no -q`
Expected: ALL PASS（既存の 79 件 + 新規 6 件 (Task1+Task2) = 85 件）

- [ ] **Step 6: コミット**

```bash
git add tests/conftest.py tests/fixtures/input_sample.csv
git commit -m "chore: conftest と input_sample.csv に Yahoo grouping 用 3 列を追加"
```

---

## Task 4: Yahoo Converter 全面書き換え (85列対応 + grouping/variation 実装)

**Files:**
- Rewrite: `src/product_register/converters/yahoo.py`
- Modify: `tests/test_yahoo.py`

> このタスクは Yahoo Converter の中核。既存 13 件 + 新規 14 件のテストを一気に通す。

- [ ] **Step 1: tests/test_yahoo.py を全面差し替え**

`tests/test_yahoo.py` を以下に置き換える:

```python
from conftest import make_product
from product_register.converters.yahoo import YahooConverter, YAHOO_COLUMNS

EXPECTED_85_COLUMNS = [
    "path", "name", "code", "sub-code", "original-price", "price", "sale-price", "member-price",
    "options", "headline", "caption", "abstract", "explanation", "additional1", "additional2", "additional3",
    "ship-weight", "taxable", "release-date", "point-code", "meta-desc", "sale-period-start", "sale-period-end", "sale-limit",
    "sp-code", "pr-rate", "brand-code", "product-code", "jan", "delivery", "condition", "product-category",
    "spec1", "spec2", "spec3", "spec4", "spec5", "spec6", "spec7", "spec8", "spec9", "spec10",
    "display", "sp-additional", "sort_priority",
    "original-price-evidence", "lead-time-instock", "lead-time-outstock", "keep-stock", "postage-set", "taxrate-type", "item-tag",
    "reserve-price", "reserve-sale-price", "reserve-member-price", "reserve-selling-period-start", "reserve-selling-period-end",
    "subscription-type", "subscription-price", "subscription-group-index", "subscription-recommended-cycle", "subscription-point-code",
    "video", "point-immediate", "eco-setting-id", "eco-setting-evidence-url",
    "grouping-id", "variation1-spec-id", "variation1-free-title", "variation1-name",
    "variation2-spec-id", "variation2-free-title", "variation2-name",
    "variation3-spec-id", "variation3-free-title", "variation3-name",
    "variation4-spec-id", "variation4-free-title", "variation4-name",
    "variation5-spec-id", "variation5-free-title", "variation5-name",
    "item-social-gift-type", "cross-border-agency-flag", "item-image-urls",
]


# ===== 既存テスト (移行) =====

def test_yahoo_code():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383", yahoo_path="沖縄のお酒")])
    assert rows[0]["code"] == "t002-2542-1"


def test_yahoo_tax_inclusive_price():
    conv = YahooConverter()
    rows = conv.convert([make_product(selling_price=10000, tax_rate=10, yahoo_category_id="41383")])
    assert rows[0]["price"] == "11000"


def test_yahoo_tax_inclusive_price_8pct():
    conv = YahooConverter()
    rows = conv.convert([make_product(selling_price=800, tax_rate=8, yahoo_category_id="20946")])
    assert rows[0]["price"] == "864"


def test_yahoo_taxrate_type():
    conv = YahooConverter()
    rows = conv.convert([make_product(tax_rate=10, yahoo_category_id="41383")])
    assert rows[0]["taxrate-type"] == "0.1"


def test_yahoo_taxrate_type_8pct():
    conv = YahooConverter()
    rows = conv.convert([make_product(tax_rate=8, yahoo_category_id="20946")])
    assert rows[0]["taxrate-type"] == "0.08"


def test_yahoo_category():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383", yahoo_path="沖縄のお酒")])
    assert rows[0]["product-category"] == "41383"
    assert rows[0]["path"] == "沖縄のお酒"


def test_yahoo_85_columns():
    """列数が 85 (旧42から拡張)"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert len(rows[0]) == 85


def test_yahoo_column_order():
    """カラム順が Yahoo 公式アップロードフォーマット (data_input202605122227.csv) と完全一致"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert list(rows[0].keys()) == EXPECTED_85_COLUMNS


def test_yahoo_display():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["display"] == "1"


def test_yahoo_keep_stock():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["keep-stock"] == "1"


def test_yahoo_delivery_defaults():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["delivery"] == "0"
    assert rows[0]["condition"] == "0"
    assert rows[0]["taxable"] == "1"
    assert rows[0]["ship-weight"] == "1"


def test_yahoo_lead_time():
    conv = YahooConverter()
    rows = conv.convert([make_product(lead_time=3, yahoo_category_id="41383")])
    assert rows[0]["lead-time-instock"] == "3"
    assert rows[0]["lead-time-outstock"] == "3"


def test_yahoo_postage_set():
    conv = YahooConverter()
    rows = conv.convert([make_product(delivery_method=1, yahoo_category_id="41383")])
    assert rows[0]["postage-set"] == "1"


def test_yahoo_caption_contains_imglist():
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=3, yahoo_category_id="41383")])
    caption = rows[0]["caption"]
    assert "<!--imgList-->" in caption
    assert "<!--/imgList-->" in caption
    assert "okimarumarket/t002-2542-1_2.jpg" in caption
    assert "okimarumarket/t002-2542-1_3.jpg" in caption


def test_yahoo_sp_additional_equals_caption():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["sp-additional"] == rows[0]["caption"]


def test_yahoo_original_price_equals_price():
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_category_id="41383")])
    assert rows[0]["original-price"] == rows[0]["price"]


# ===== 新規テスト: grouping-id =====

def test_yahoo_grouping_id_auto():
    """yahoo_grouping_enabled=True で ne_code 末尾の -数字 を取り除く"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="t002-2542-3", quantity=3,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "t002-2542"


def test_yahoo_grouping_id_double_digit():
    """quantity=10 のような 2 桁数字も正しく trim"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="n019-0250-10", quantity=10,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "n019-0250"


def test_yahoo_grouping_id_disabled():
    """yahoo_grouping_enabled=False のときは grouping-id は空"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=False)])
    assert rows[0]["grouping-id"] == ""


def test_yahoo_grouping_id_S01_preserved():
    """ne_code 末尾が -S01 のように英字を含む場合は trim せず ne_code そのまま"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="t002-2542-S01", quantity=1,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "t002-2542-S01"


# ===== 新規テスト: variation1-* =====

def test_yahoo_variation1_spec_id_always_empty():
    """variation1-spec-id は常に空 (フリータイトル方式)"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=True, yahoo_variation_title="数量")])
    assert rows[0]["variation1-spec-id"] == ""


def test_yahoo_variation1_title():
    """yahoo_variation_title がそのまま variation1-free-title に入る"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=True, yahoo_variation_title="数量")])
    assert rows[0]["variation1-free-title"] == "数量"


def test_yahoo_variation1_name_single():
    """quantity=1, unit='袋' → '1袋'"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        quantity=1, unit="袋",
        yahoo_grouping_enabled=True, yahoo_variation_title="数量",
    )])
    assert rows[0]["variation1-name"] == "1袋"


def test_yahoo_variation1_name_set():
    """quantity=5, unit='袋' → '5袋セット'"""
    conv = YahooConverter()
    rows = conv.convert([make_product(
        quantity=5, unit="袋",
        yahoo_grouping_enabled=True, yahoo_variation_title="数量",
    )])
    assert rows[0]["variation1-name"] == "5袋セット"


def test_yahoo_variation1_empty_when_disabled():
    """yahoo_grouping_enabled=False のとき variation1-free-title と -name は空"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=False)])
    assert rows[0]["variation1-free-title"] == ""
    assert rows[0]["variation1-name"] == ""


# ===== 新規テスト: variation2-5 =====

def test_yahoo_variation2_through_5_empty():
    """variation2-5 系 9 列は全て空 (今回スコープ外)"""
    conv = YahooConverter()
    rows = conv.convert([make_product(yahoo_grouping_enabled=True)])
    for n in range(2, 6):
        assert rows[0][f"variation{n}-spec-id"] == ""
        assert rows[0][f"variation{n}-free-title"] == ""
        assert rows[0][f"variation{n}-name"] == ""


# ===== 新規テスト: item-image-urls =====

def test_yahoo_item_image_urls():
    """image_count=3 → 3 URL セミコロン区切り、1枚目はサフィックスなし"""
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=3)])
    urls = rows[0]["item-image-urls"].split(";")
    assert len(urls) == 3
    assert urls[0] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg"
    assert urls[1] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_2.jpg"
    assert urls[2] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_3.jpg"


def test_yahoo_item_image_urls_count_1():
    """image_count=1 → URL 1 件のみ、セミコロンなし"""
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=1)])
    assert rows[0]["item-image-urls"] == "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg"


def test_yahoo_item_image_urls_count_0():
    """image_count=0 → 空文字列"""
    conv = YahooConverter()
    rows = conv.convert([make_product(image_count=0)])
    assert rows[0]["item-image-urls"] == ""


# ===== 新規テスト: 警告ログ =====

def test_yahoo_warns_when_grouping_enabled_but_unit_empty(caplog):
    """yahoo_grouping_enabled=True かつ unit="" の商品があると WARNING ログを出す"""
    import logging
    conv = YahooConverter()
    with caplog.at_level(logging.WARNING):
        rows = conv.convert([make_product(
            ne_code="x999-9999-5", quantity=5, unit="",
            yahoo_grouping_enabled=True, yahoo_variation_title="数量",
        )])
    # 警告が記録される
    assert any("unit" in rec.message and "x999-9999-5" in rec.message
               for rec in caplog.records if rec.levelno == logging.WARNING)
    # 一方で出力は壊れていても止まらない
    assert rows[0]["variation1-name"] == "5セット"


def test_yahoo_no_warning_when_unit_set(caplog):
    """unit がセットされていれば WARNING は出ない"""
    import logging
    conv = YahooConverter()
    with caplog.at_level(logging.WARNING):
        conv.convert([make_product(
            unit="袋", yahoo_grouping_enabled=True, yahoo_variation_title="数量",
        )])
    assert not any("unit" in rec.message
                   for rec in caplog.records if rec.levelno == logging.WARNING)
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `pytest tests/test_yahoo.py -v --tb=no -q`
Expected: 多数 FAIL（カラム数が 42、新規列が存在しない）

- [ ] **Step 3: Yahoo Converter を全面書き換え**

`src/product_register/converters/yahoo.py` を以下に置き換える:

```python
from __future__ import annotations
import logging
import math
import re
from product_register.models import ProductInput
from product_register.converters.base import BaseConverter

logger = logging.getLogger(__name__)


# Yahoo Shopping CSV 85列（公式アップロードフォーマット data_input202605122227.csv 準拠）
YAHOO_COLUMNS = [
    "path", "name", "code", "sub-code", "original-price", "price", "sale-price", "member-price",
    "options", "headline", "caption", "abstract", "explanation", "additional1", "additional2", "additional3",
    "ship-weight", "taxable", "release-date", "point-code", "meta-desc", "sale-period-start", "sale-period-end", "sale-limit",
    "sp-code", "pr-rate", "brand-code", "product-code", "jan", "delivery", "condition", "product-category",
    "spec1", "spec2", "spec3", "spec4", "spec5", "spec6", "spec7", "spec8", "spec9", "spec10",
    "display", "sp-additional", "sort_priority",
    "original-price-evidence", "lead-time-instock", "lead-time-outstock", "keep-stock", "postage-set", "taxrate-type", "item-tag",
    "reserve-price", "reserve-sale-price", "reserve-member-price", "reserve-selling-period-start", "reserve-selling-period-end",
    "subscription-type", "subscription-price", "subscription-group-index", "subscription-recommended-cycle", "subscription-point-code",
    "video", "point-immediate", "eco-setting-id", "eco-setting-evidence-url",
    "grouping-id", "variation1-spec-id", "variation1-free-title", "variation1-name",
    "variation2-spec-id", "variation2-free-title", "variation2-name",
    "variation3-spec-id", "variation3-free-title", "variation3-name",
    "variation4-spec-id", "variation4-free-title", "variation4-name",
    "variation5-spec-id", "variation5-free-title", "variation5-name",
    "item-social-gift-type", "cross-border-agency-flag", "item-image-urls",
]


# ===== 既存ヘルパー (流用) =====

def _strip_html(text: str) -> str:
    """HTMLタグを除去してプレーンテキストを返す"""
    return re.sub(r"<[^>]+>", "", text)


def _to_single_quotes(html: str) -> str:
    """HTML属性のダブルクォートをシングルクォートに変換"""
    return html.replace('"', "'")


def _build_img_list(ne_code: str, image_count: int) -> str:
    """Yahoo用の画像リストHTML（画像2番目以降）を生成する。"""
    if image_count <= 1:
        return ""
    base = f"https://shopping.c.yimg.jp/lib/okimarumarket/{ne_code}"
    parts = []
    for i in range(2, image_count + 1):
        parts.append(f"<img src='{base}_{i}.jpg' width='100%'>")
    return "<!--imgList-->" + "<br>".join(parts) + "<br><!--/imgList-->"


def _build_caption(ne_code: str, image_count: int, description_pc: str) -> str:
    """caption / sp-additional 用のHTML"""
    img_html = _build_img_list(ne_code, image_count)
    desc_html = _to_single_quotes(description_pc)
    return img_html + desc_html


def _build_explanation(free1: str, description_pc: str) -> str:
    """explanation: free1のプレーンテキスト。なければ description_pc からHTMLを除去"""
    source = free1 if free1 else description_pc
    return _strip_html(source)


# ===== 新規ヘルパー =====

def _resolve_grouping_id(ne_code: str, enabled: bool) -> str:
    """yahoo_grouping_enabled=True のとき ne_code 末尾の -数字のみ を取り除く。

    末尾が「ハイフン + 数字のみ」のときだけ trim する。S01 のように英字を含む
    場合は ne_code そのまま返す。
    """
    if not enabled:
        return ""
    parts = ne_code.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0]
    return ne_code


def _build_variation_name(quantity: int, unit: str) -> str:
    """quantity と unit から variation1-name を生成。

    例: quantity=1, unit="袋" → "1袋"
    例: quantity=5, unit="袋" → "5袋セット"
    """
    if quantity == 1:
        return f"1{unit}"
    return f"{quantity}{unit}セット"


def _build_item_image_urls(ne_code: str, image_count: int) -> str:
    """画像URL をセミコロン区切りで生成。

    1枚目: {base}/{ne_code}.jpg
    N≥2: {base}/{ne_code}_{N}.jpg
    """
    if image_count <= 0:
        return ""
    base = "https://shopping.c.yimg.jp/lib/okimarumarket"
    urls = []
    for i in range(1, image_count + 1):
        suffix = "" if i == 1 else f"_{i}"
        urls.append(f"{base}/{ne_code}{suffix}.jpg")
    return ";".join(urls)


class YahooConverter(BaseConverter):
    mall_name = "yahoo"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        return [self._convert_one(p) for p in products]

    def _convert_one(self, p: ProductInput) -> dict:
        # grouping=True かつ unit が空のとき警告ログ
        if p.yahoo_grouping_enabled and not p.unit:
            logger.warning(
                f"ne_code={p.ne_code}: yahoo_grouping_enabled=True だが unit が空。"
                f"variation1-name が壊れた値になる可能性"
            )

        # 税込価格 = selling_price * (1 + tax_rate/100)、四捨五入
        tax_inclusive = str(math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5))

        # 税率: 8 → "0.08", 10 → "0.1"
        taxrate_type = str(p.tax_rate / 100)

        # caption / sp-additional
        caption = _build_caption(p.ne_code, p.image_count, p.description_pc)

        # explanation (プレーンテキスト)
        explanation = _build_explanation(p.free1, p.description_pc)

        # grouping-id / variation1
        grouping_id = _resolve_grouping_id(p.ne_code, p.yahoo_grouping_enabled)
        variation1_title = p.yahoo_variation_title if p.yahoo_grouping_enabled else ""
        variation1_name = _build_variation_name(p.quantity, p.unit) if p.yahoo_grouping_enabled else ""

        # item-image-urls
        item_image_urls = _build_item_image_urls(p.ne_code, p.image_count)

        # 85列全てを空で初期化してから値を上書き
        row = {col: "" for col in YAHOO_COLUMNS}
        row.update({
            "path": p.yahoo_path,
            "name": p.display_name,
            "code": p.ne_code,
            "original-price": tax_inclusive,
            "price": tax_inclusive,
            "headline": p.catch_copy_yahoo,
            "caption": caption,
            "explanation": explanation,
            "ship-weight": "1",
            "taxable": "1",
            "jan": p.jan_code,
            "delivery": "0",
            "condition": "0",
            "product-category": p.yahoo_category_id,
            "display": "1",
            "sp-additional": caption,
            "lead-time-instock": str(p.lead_time),
            "lead-time-outstock": str(p.lead_time),
            "keep-stock": "1",
            "postage-set": str(p.delivery_method),
            "taxrate-type": taxrate_type,
            "grouping-id": grouping_id,
            "variation1-free-title": variation1_title,
            "variation1-name": variation1_name,
            "item-image-urls": item_image_urls,
        })
        return row
```

- [ ] **Step 4: テスト実行 → 成功確認**

Run: `pytest tests/test_yahoo.py -v --tb=short`
Expected: ALL PASS（test_yahoo.py 合計 31 件 = 既存 15 件（うち `_42_columns` は `_85_columns` にリネーム）+ 新規 16 件: `column_order` + grouping 4 + variation1 5 + variation2-5 1 + item-image-urls 3 + 警告 2）

- [ ] **Step 5: コミット**

```bash
git add src/product_register/converters/yahoo.py tests/test_yahoo.py
git commit -m "feat: Yahoo Converter を 85 列 + grouping/variation/item-image-urls 対応に書き換え"
```

---

## Task 5: 期待値 CSV を 85 列形式に再生成

**Files:**
- Regen: `tests/fixtures/expected/yahoo.csv`

> 既存 Excel テンプレートに Yahoo 出力シートがないため、Converter の実装出力を **手動チェックを経て** 期待値として固定する。

- [ ] **Step 1: Converter で実出力を生成**

Run: `python -m product_register convert tests/fixtures/input_sample.csv -o ./output/`
Expected: `output/yahoo.csv` が 85列 × 7商品で生成

- [ ] **Step 2: 出力内容を目視確認**

Windows PowerShell では `python -c "..."` 内のクォートエスケープが効きにくいため、独立スクリプトを用意:

`scripts/_dump_yahoo_summary.py` を作成（このスクリプトは Task 5 後に削除）:

```python
"""Yahoo Converter 出力の grouping/variation/画像数を一覧出力する確認用スクリプト。"""
import csv
from pathlib import Path

with open(Path('output/yahoo.csv'), encoding='utf-8-sig', newline='') as f:
    rows = list(csv.DictReader(f))

for r in rows:
    img_count = r['item-image-urls'].count(';') + 1 if r['item-image-urls'] else 0
    print(f"{r['code']:18s} | grouping-id={r['grouping-id']:18s} | "
          f"v1-name={r['variation1-name']:12s} | imgs={img_count}")
```

Run: `python scripts/_dump_yahoo_summary.py`

Expected output（理想形）:
```
t002-2542-1        | grouping-id=t002-2542         | v1-name=1本          | imgs=7
t002-2542-3        | grouping-id=t002-2542         | v1-name=3本セット     | imgs=7
t002-2559-1        | grouping-id=t002-2559         | v1-name=1本          | imgs=7
t002-2559-3        | grouping-id=t002-2559         | v1-name=3本セット     | imgs=7
n019-0250-1        | grouping-id=n019-0250         | v1-name=1袋          | imgs=8
n019-0250-5        | grouping-id=n019-0250         | v1-name=5袋セット     | imgs=8
n019-0250-10       | grouping-id=n019-0250         | v1-name=10袋セット    | imgs=8
```

→ 期待形と一致しなければ Converter のロジックを見直す。

- [ ] **Step 3: 添付 CSV の Reference 値とパターン比較**

確認:
- ノニジュース行 (4560232380760, 4560232380760-3set, 4560232380760-6set, noni6) の grouping-id="t003-0760" / variation1-name="1本"/"3本セット"/"12本セット"/"6本セット" と同じパターンで出ているか

- [ ] **Step 4: 他モール (rakuten/ne/shopify) の期待値 CSV と現出力に差分がないことを確認**

`convert` コマンドは全モール出力するため、Yahoo 以外も `output/` に再生成される。Yahoo 以外の期待値 CSV と差分が出ていないことを確認:

Run: `python -m product_register verify ./output/ ./tests/fixtures/expected/ --log ./logs/`
Expected: `[rakuten] mismatched_rows: 0`、`[ne_single] mismatched_rows: 0`、`[ne_set] mismatched_rows: 0`、`[shopify] mismatched_rows: 0` がすべて 0。`[yahoo] mismatched_rows: N>0` のみ残る（これから期待値を更新するため）。

→ Yahoo 以外で差分が出た場合は、Task 1〜4 の変更が他モール出力にも波及していることを意味するので、原因を特定して修正。

- [ ] **Step 5: 期待値 CSV にコピー + 確認スクリプト削除**

```bash
cp output/yahoo.csv tests/fixtures/expected/yahoo.csv
rm scripts/_dump_yahoo_summary.py
```

- [ ] **Step 6: コミット**

```bash
git add tests/fixtures/expected/yahoo.csv
git commit -m "test: 期待値 yahoo.csv を 85 列形式に再生成 (grouping/variation/item-image-urls 反映)"
```

---

## Task 6: 統合テスト追加 (grouping 整合性チェック)

**Files:**
- Modify: `tests/test_integration.py`

- [ ] **Step 1: 失敗テストを書く**

`tests/test_integration.py` の末尾に追加:

```python
def test_yahoo_grouping_consistency():
    """同一 grouping-id を持つ行が Yahoo 集約として正しい構造になっていることを保証する。"""
    from product_register.converters.yahoo import YahooConverter
    products = read_input_csv(FIXTURES / "input_sample.csv")
    rows = YahooConverter().convert(products)

    # n019-0250 グループ (ちんすこう 1袋/5袋/10袋)
    chinsuko = [r for r in rows if r["grouping-id"] == "n019-0250"]
    assert len(chinsuko) == 3, "n019-0250 グループは 3 商品 (1袋/5袋/10袋)"
    assert {r["variation1-name"] for r in chinsuko} == {"1袋", "5袋セット", "10袋セット"}
    # 集約商品は path が同一でなければならない (Yahoo 仕様)
    assert len({r["path"] for r in chinsuko}) == 1, "集約商品の path は同一"

    # t002-2542 グループ (10年貯蔵 1本/3本)
    giants = [r for r in rows if r["grouping-id"] == "t002-2542"]
    assert len(giants) == 2
    assert {r["variation1-name"] for r in giants} == {"1本", "3本セット"}

    # t002-2559 グループ (16年貯蔵 1本/3本)
    giants16 = [r for r in rows if r["grouping-id"] == "t002-2559"]
    assert len(giants16) == 2
    assert {r["variation1-name"] for r in giants16} == {"1本", "3本セット"}
```

- [ ] **Step 2: テスト実行 → 成功確認**

Run: `pytest tests/test_integration.py -v -k yahoo_grouping_consistency`
Expected: PASS

- [ ] **Step 3: 全テスト再実行で回帰確認**

Run: `pytest tests/ -v --tb=no -q`
Expected: ALL PASS、**合計 102 件**。

内訳:
- 既存 79 件（うち test_yahoo.py 15 件、内 `_42_columns` は Task4 で `_85_columns` にリネーム＝件数変わらず）
- Task 1: test_models.py +2 件
- Task 2: test_reader.py +4 件
- Task 4: test_yahoo.py 新規 +16 件（`column_order` / grouping 4 / variation1 5 / variation2-5 1 / item-image-urls 3 / 警告 2）
- Task 6: test_integration.py +1 件
- 合計: 79 + 2 + 4 + 16 + 1 = **102 件**

- [ ] **Step 4: コミット**

```bash
git add tests/test_integration.py
git commit -m "test: Yahoo grouping 整合性チェックの統合テスト追加"
```

---

## Task 7: CLI verify コマンドで差分ゼロを確認

**Files:** (検証のみ、コード変更なし)

- [ ] **Step 1: convert 実行**

Run: `python -m product_register convert tests/fixtures/input_sample.csv -o ./output/`
Expected: 完了メッセージ、`output/yahoo.csv` が更新される

- [ ] **Step 2: verify 実行**

Run: `python -m product_register verify ./output/ ./tests/fixtures/expected/ --log ./logs/`
Expected: `[yahoo] mismatched_rows: 0` で全モール一致

- [ ] **Step 3: logs/ の最新 JSON を目視**

Run:
```bash
ls -t logs/verify_yahoo_*.json | head -1 | xargs cat
```
Expected: `"mismatched_rows": 0`

- [ ] **Step 4: 全テスト再実行 (最終回帰確認)**

Run: `pytest tests/ -v --tb=no -q`
Expected: `102 passed`（既存 79 + Task1 +2 + Task2 +4 + Task4 +16 + Task6 +1）
※ Task4 内訳: 既存 yahoo 16 件は維持 (`_42_columns` は `_85_columns` にリネーム)、新規 16 件 = grouping 4 + variation1 5 + variation2-5 1 + item-image-urls 3 + 警告 2 + column_order 1。

- [ ] **Step 5: 完了報告コミットなし（変更ないため）**

このタスクは検証専用のためコミットは不要。差分があれば該当 Task に戻って修正。

---

## Task 8: クリーンアップ + 最終確認

**Files:**
- Cleanup: `logs/`, `output/`

- [ ] **Step 1: logs/ と output/ の中身を確認**

```bash
ls output/ logs/
```

Expected: `.gitignore` で除外されているので git status に出ないこと。

Run: `git status`
Expected: `nothing to commit, working tree clean`（または untracked のみ）

- [ ] **Step 2: README/CLAUDE.md 等で Yahoo Converter のスペック更新が必要かチェック**

Run: `grep -r "42列" docs/ src/ tests/ 2>&1 | grep -v "\.pyc"`
Expected: ヒットなし（42列の記述が残っていないこと）

もし残っていれば該当箇所を「85列」「Yahoo grouping 対応」に更新してコミット。

- [ ] **Step 3: ブランチ状態を確認**

Run: `git log --oneline -10`
Expected: Task 1〜7 のコミットが順に並ぶ

- [ ] **Step 4: 完了**

Yahoo Converter rewrite 完了。設計書の完了基準を満たす:
- ✅ pytest 全件パス (102件)
- ✅ verify mismatched_rows == 0
- ✅ test_yahoo_grouping_consistency で集約構造を assert
- ✅ ちんすこうグループの 3 商品が同一 grouping-id, variation1-name が ["1袋","5袋セット","10袋セット"]

### 後続タスク (Phase 1 完了後の運用検証 - 別 PR)

- Yahoo テストストア (`test.circus.shopping.yahooapis.jp`) に 1 グループ (3 商品) 実アップロード
- 「数量」セレクタが Yahoo 管理画面で動作することを目視確認
- `docs/Yahoo/運用ガイド.md` に既存登録商品への上書き挙動の事前確認 SOP を記述
