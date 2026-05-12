# Yahoo Converter 再書き直し — セット集約 + 85列フォーマット対応 設計書

**作成日:** 2026-05-12
**対象:** [src/product_register/converters/yahoo.py](../../../src/product_register/converters/yahoo.py)
**スコープ:** Phase 1 (CSV出力CLIツール)
**実装アプローチ:** 一括書き換え（Approach B）

---

## 1. 背景・課題

直近 c3ea62e で Yahoo Converter を 42 列フォーマットに書き直したが、実運用上の重大な問題が判明した。

### 問題: セット商品が単品と区別なく出力される

入力データでは、セット商品は単品と「`quantity` と `selling_price` 以外まったく同じ」状態で渡される。
Yahoo Converter はそれをそのまま流すため、Yahoo ストア上で **「まったく同じ商品が複数並び、価格だけバラバラ」** という最悪のUXになる。

実例 — ちんすこう (n019-0250) の現状出力 (Yahoo CSV):

```
列名             | 単品(-1)      | 5袋セット(-5)  | 10袋セット(-10)
----------------+--------------+--------------+----------------
code            | n019-0250-1  | n019-0250-5  | n019-0250-10
name            | (同じ)        | (同じ)        | (同じ)
price           | 864          | 4,320        | 3,200
他37列の値       | (全て同じ)
```

### 解決方針: 添付CSV (data_input202605122227.csv) で判明した Yahoo の grouping 機構を採用

ノニジュースの実例:

```
code                  | grouping-id   | variation1-free-title | variation1-name | price
----------------------+---------------+----------------------+-----------------+-------
4560232380760         | t003-0760     | 数量                  | 1本              | 2,200
4560232380760-3set    | t003-0760     | 数量                  | 3本セット         | 5,960
4560232380760-6set    | t003-0760     | 数量                  | 12本セット        | 20,670
noni6                 | t003-0760     | 数量                  | 6本セット         | 10,800
apitest               | (空)          | (空)                  | (空)            | 10,280
```

→ 共通の `grouping-id` を持つ商品が **1 つの商品ページに集約され**、「数量」セレクタで選択可能になる。
今回はこの方式を採用し、Yahoo Converter を 85 列の正規アップロードフォーマットに移行する。

---

## 2. スコープ

### 今回スコープに含めるもの

1. 出力フォーマットを **42 列 → 85 列** に拡張（添付CSVの列順を完全踏襲）
2. **grouping-id** + **variation1-free-title** + **variation1-name** を埋める
3. **item-image-urls** 列を lib 形式 URL で埋める
4. [src/product_register/models.py](../../../src/product_register/models.py) に 3 列追加
5. テストデータ・期待値 CSV を 85 列形式に再構築

### 今回スコープに含めないもの（将来拡張）

- `spec1〜spec10` / `brand-code` / `abstract` / `meta-desc` / `sale-price` / `sale-period-*` 等の空欄列充足
- `variation2〜variation5` 系（多軸バリエーション。Phase 2 で対応）
- 異種セット（`-S01` 表記）の特別扱い — 末尾が数字でない場合は ne_code そのまま grouping-id にして将来対応
- 画像アップロードAPI連携（item-image-urls の動的URL対応は Phase 2 以降）

---

## 3. データモデル変更

[src/product_register/models.py](../../../src/product_register/models.py) の `ProductInput` に **3 列追加**（全てデフォルト値ありの optional）。

```python
class ProductInput(BaseModel):
    # …既存フィールドはそのまま…

    # Yahoo セット集約用 (新規追加)
    unit: str = ""                        # 単位 (例: "本", "袋", "個", "枚")
    yahoo_grouping_enabled: bool = False  # grouping を有効にするか
    yahoo_variation_title: str = ""       # variation1-free-title (例: "数量")
```

### バリデーション方針

入れない方向で進める。理由:

- `yahoo_grouping_enabled=True` でも `unit` や `yahoo_variation_title` が空のケースを許容したい（フォーマット崩れより警告ログのほうが運用しやすい）
- `ne_code` の末尾形式チェックは grouping-id 生成時の正規表現に任せ、不一致なら ne_code そのまま使う（S01 等の将来拡張に備える）

### テストデータ ([tests/fixtures/input_sample.csv](../../../tests/fixtures/input_sample.csv))

7 商品全行に以下を設定:

| ne_code | unit | yahoo_grouping_enabled | yahoo_variation_title |
|---|---|---|---|
| t002-2542-1 | 本 | TRUE | 数量 |
| t002-2542-3 | 本 | TRUE | 数量 |
| t002-2559-1 | 本 | TRUE | 数量 |
| t002-2559-3 | 本 | TRUE | 数量 |
| n019-0250-1 | 袋 | TRUE | 数量 |
| n019-0250-5 | 袋 | TRUE | 数量 |
| n019-0250-10 | 袋 | TRUE | 数量 |

→ Yahoo 上で 3 グループに集約:
- `t002-2542` (10年貯蔵: 1本 / 3本セット)
- `t002-2559` (16年貯蔵: 1本 / 3本セット)
- `n019-0250` (ちんすこう: 1袋 / 5袋セット / 10袋セット)

---

## 4. Yahoo Converter ロジック設計

### 出力カラム順序 (85列・添付CSV準拠)

```
path, name, code, sub-code, original-price, price, sale-price, member-price,
options, headline, caption, abstract, explanation, additional1, additional2, additional3,
ship-weight, taxable, release-date, point-code, meta-desc, sale-period-start, sale-period-end, sale-limit,
sp-code, pr-rate, brand-code, product-code, jan, delivery, condition, product-category,
spec1, spec2, spec3, spec4, spec5, spec6, spec7, spec8, spec9, spec10,
display, sp-additional, sort_priority,
original-price-evidence, lead-time-instock, lead-time-outstock, keep-stock, postage-set, taxrate-type, item-tag,
reserve-price, reserve-sale-price, reserve-member-price, reserve-selling-period-start, reserve-selling-period-end,
subscription-type, subscription-price, subscription-group-index, subscription-recommended-cycle, subscription-point-code,
video, point-immediate, eco-setting-id, eco-setting-evidence-url,
grouping-id, variation1-spec-id, variation1-free-title, variation1-name,
variation2-spec-id, variation2-free-title, variation2-name,
variation3-spec-id, variation3-free-title, variation3-name,
variation4-spec-id, variation4-free-title, variation4-name,
variation5-spec-id, variation5-free-title, variation5-name,
item-social-gift-type, cross-border-agency-flag, item-image-urls
```

### 値を入れる列 (今回スコープ) — 既存21列 + 新規3列 = 24列

| カラム | 値の生成ルール |
|---|---|
| `code` | `ne_code` |
| `name` | `display_name` |
| `path` | `yahoo_path` |
| `display` | `"1"` |
| `original-price` | 税込価格 |
| `price` | 税込価格 |
| `jan` | `jan_code` |
| `product-category` | `yahoo_category_id` |
| `headline` | `catch_copy_yahoo` |
| `caption` | `_build_caption(ne_code, image_count, description_pc)` |
| `explanation` | `_build_explanation(free1, description_pc)` |
| `sp-additional` | caption と同じ |
| `delivery` | `"0"` |
| `postage-set` | `str(delivery_method)` |
| `ship-weight` | `"1"` |
| `condition` | `"0"` |
| `taxable` | `"1"` |
| `taxrate-type` | `str(tax_rate / 100)` |
| `lead-time-instock` | `str(lead_time)` |
| `lead-time-outstock` | `str(lead_time)` |
| `keep-stock` | `"1"` |
| **`grouping-id`** (新規) | `_build_grouping_id(ne_code, yahoo_grouping_enabled)` |
| **`variation1-free-title`** (新規) | `yahoo_variation_title` if `yahoo_grouping_enabled` else `""` |
| **`variation1-name`** (新規) | `_build_variation_name(quantity, unit)` if `yahoo_grouping_enabled` else `""` |
| **`item-image-urls`** (新規) | `_build_item_image_urls(ne_code, image_count)` |
| 残り 61 列 | 全て空欄 |

### 主要ヘルパー関数

```python
def _build_grouping_id(ne_code: str, enabled: bool) -> str:
    """yahoo_grouping_enabled=True のとき ne_code 末尾の -数字 を取り除く。
    例: t002-2542-1 → t002-2542 / n019-0250-10 → n019-0250
    末尾が数字でなければ ne_code をそのまま返す（S01 等の将来拡張に備える）。
    """
    if not enabled:
        return ""
    match = re.match(r"^(.+)-(\d+)$", ne_code)
    return match.group(1) if match else ne_code


def _build_variation_name(quantity: int, unit: str) -> str:
    """quantity と unit から表示名を生成。
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
    base = "https://shopping.c.yimg.jp/lib/okimarumarket"
    urls = []
    for i in range(1, image_count + 1):
        suffix = "" if i == 1 else f"_{i}"
        urls.append(f"{base}/{ne_code}{suffix}.jpg")
    return ";".join(urls)
```

### 出力例 — ちんすこう (n019-0250) のセット集約

| 列 | n019-0250-1 | n019-0250-5 | n019-0250-10 |
|---|---|---|---|
| code | `n019-0250-1` | `n019-0250-5` | `n019-0250-10` |
| **grouping-id** | **`n019-0250`** | **`n019-0250`** | **`n019-0250`** |
| **variation1-free-title** | `数量` | `数量` | `数量` |
| **variation1-name** | **`1袋`** | **`5袋セット`** | **`10袋セット`** |
| **item-image-urls** | `…/n019-0250-1.jpg;…/n019-0250-1_2.jpg;…(計8件)` | 同様(8件) | 同様(8件) |
| price | 864 | 4320 | 3200 |

### Yahoo ストア上での見え方

```
==== Yahoo ストア (集約後) ====
[商品ページ A] 巨人 GIANTSボトル 10年貯蔵古酒...
                数量: ○1本 ¥11,000  ○3本セット ¥33,000

[商品ページ B] GIANTSボトル 16年貯蔵古酒...
                数量: ○1本 ¥33,000  ○3本セット ¥55,000

[商品ページ C] ホワイトショコラ in 塩ちんすこう 12個入り
                数量: ○1袋 ¥864  ○5袋セット ¥4,320  ○10袋セット ¥3,200
```

→ 7 商品が 3 つの商品ページに集約され、お客さんは数量を選択するだけ。

---

## 5. テスト戦略

### 既存テスト ([tests/test_yahoo.py](../../../tests/test_yahoo.py)) の更新

- `test_yahoo_42_columns` → `test_yahoo_85_columns` にリネーム + 期待値変更
- 既存 13 テストはそのまま通る想定（code/name/price/headline/explanation/caption/sp-additional/delivery系/taxable/taxrate-type/lead-time/postage-set はロジック変更なし）

### 新規テストケース（10件）

| テスト | 検証内容 |
|---|---|
| `test_yahoo_85_columns` | 列数が 85 |
| `test_yahoo_column_order` | カラム順が添付CSVと完全一致 |
| `test_yahoo_grouping_id_auto` | `t002-2542-3` (quantity=3) → `grouping-id=t002-2542` |
| `test_yahoo_grouping_id_disabled` | `yahoo_grouping_enabled=False` → `grouping-id=""` |
| `test_yahoo_variation1_title` | `yahoo_variation_title="数量"` がそのまま出力 |
| `test_yahoo_variation1_name_single` | quantity=1, unit="袋" → `"1袋"` |
| `test_yahoo_variation1_name_set` | quantity=5, unit="袋" → `"5袋セット"` |
| `test_yahoo_variation1_empty_when_disabled` | grouping=False のときは variation1-* 全て空 |
| `test_yahoo_variation2_through_5_empty` | variation2〜5 は常に空 |
| `test_yahoo_item_image_urls` | image_count=3 → 3つのURLをセミコロン区切り、1枚目はサフィックスなし |

### conftest.py の `make_product` 更新

```python
defaults = dict(
    # …既存…
    unit="本",
    yahoo_grouping_enabled=True,
    yahoo_variation_title="数量",
)
```

### 期待値 CSV ([tests/fixtures/expected/yahoo.csv](../../../tests/fixtures/expected/yahoo.csv))

7商品 × 42列 → 7商品 × 85列に再生成。期待値は **Yahoo Converter 実装後の出力をベース**にし、grouping-id / variation1-* / item-image-urls の値を目視チェックして固定する（既存Excelテンプレートに Yahoo 出力シートはないため）。

### 統合テスト ([tests/test_integration.py](../../../tests/test_integration.py))

`test_yahoo_matches_excel_output` 相当のテストで、`compare_csv` の比較キーは `code` 単一キーを継続使用（grouping-id は重複しても `code` は一意）。

---

## 6. 完了基準

- [ ] `pytest tests/` が全件パス（既存79件 + 新規10件）
- [ ] `product-register convert tests/fixtures/input_sample.csv -o ./output/` が `output/yahoo.csv` を生成し、85列で grouping-id / variation1-* / item-image-urls が期待通り埋まる
- [ ] `product-register verify ./output/ ./tests/fixtures/expected/` で yahoo の差分 0
- [ ] 目視確認: ちんすこうグループの 3 商品が同一 grouping-id を持ち、それぞれ variation1-name が「1袋」「5袋セット」「10袋セット」
