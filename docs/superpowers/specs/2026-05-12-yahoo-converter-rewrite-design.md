# Yahoo Converter 再書き直し — セット集約 + 85列フォーマット対応 設計書

**作成日:** 2026-05-12
**改訂:** v2 (spec-review 指摘反映)
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

### 解決方針: Yahoo の grouping 機構を採用

添付CSV [data_input202605122227.csv](../../../docs/Yahoo/data_input202605122227.csv) のノニジュースの実例:

```
code                  | grouping-id   | variation1-spec-id | variation1-free-title | variation1-name | price
----------------------+---------------+--------------------+----------------------+-----------------+-------
4560232380760         | t003-0760     | (空)                | 数量                  | 1本              | 2,200
4560232380760-3set    | t003-0760     | (空)                | 数量                  | 3本セット         | 5,960
4560232380760-6set    | t003-0760     | (空)                | 数量                  | 12本セット        | 20,670
noni6                 | t003-0760     | (空)                | 数量                  | 6本セット         | 10,800
apitest               | (空)          | (空)                | (空)                  | (空)             | 10,280
```

→ 共通の `grouping-id` を持つ商品が **1 つの商品ページに集約され**、「数量」セレクタで選択可能になる。
今回はこの方式を採用し、Yahoo Converter を 85 列の正規アップロードフォーマットに移行する。

### 重要: variation1_spec_id は空でよい根拠

[docs/Yahoo/04-オプション・バリエーション設定.md:199](../../../docs/Yahoo/04-オプション・バリエーション設定.md) には「バリエーションスペックIDは商品のスペック設定に存在するIDのみ指定可能」とあるが、添付 CSV の 4 行 (4560232380760, 4560232380760-3set, 4560232380760-6set, noni6) は全て **`variation1-spec-id=空 / variation1-free-title="数量" / variation1-name="N本セット"`** のパターンで動作実績がある。

→ Yahoo CSV アップロードフォーマットでは、**`variation1-spec-id` を空にして `variation1-free-title` + `variation1-name` のみで「フリータイトル方式」によりバリエーションを定義できる**。これを本設計のコア前提とする。

---

## 2. スコープ

### 今回スコープに含めるもの

1. 出力フォーマットを **42 列 → 85 列** に拡張（添付CSVの列順を完全踏襲）
2. **grouping-id** + **variation1-free-title** + **variation1-name** を埋める（variation1-spec-id は常に空）
3. **item-image-urls** 列を lib 形式 URL で埋める
4. [src/product_register/models.py](../../../src/product_register/models.py) に 3 列追加
5. [src/product_register/reader.py](../../../src/product_register/reader.py) に **bool 変換ロジック追加**（後述）
6. テストデータ・期待値 CSV を 85 列形式に再構築

### 今回スコープに含めないもの（将来拡張）

- `spec1〜spec10` / `brand-code` / `abstract` / `meta-desc` / `sale-price` / `sale-period-*` 等の空欄列充足
- `variation2〜variation5` 系（多軸バリエーション。Phase 2 で対応）
- 異種セット（`-S01` 表記）の集約対応 — 今回は **`grouping-id` を ne_code そのままにして個別商品として扱う**
- 画像アップロードAPI連携（item-image-urls の動的URL対応は Phase 2 以降）

---

## 3. 運用上の注意（既存登録商品への副作用）

### 重要前提

[editItem API 仕様](../../../docs/Yahoo/02-商品登録更新-editItem.md) には「省略した項目はデフォルト値で上書き」と明記されている。本 CSV は **CSV アップロード** 経路のため editItem API とは別経路だが、**同様の上書き挙動を想定して扱う**。

### 必須運用手順（Phase 1 で実装担当者が守る運用ガイド）

1. **既存登録商品への適用前に Yahoo テストストア (`test.circus.shopping.yahooapis.jp`) で動作確認**
2. CSV 全列のうち、空欄列が 60 列以上ある → 既存登録項目を空で上書きしてしまうリスク
3. 本リリースでアップロード対象とする列を Yahoo 側のアップロード仕様で再確認:
   - 「アップロード時に未指定列はスキップ」モードがあるなら必ず ON
   - もしくは更新差分のみアップロードする運用に切り替え
4. 既存商品で **caption / explanation / 画像URL を保ったまま grouping-id だけ追加** したい場合の手順を運用 SOP に明記
5. Phase 1 では **新規商品登録のみで採用**し、既存登録商品への上書きは Phase 2 で「上書き安全モード」を実装してから対応する選択肢を残す

→ この章は Phase 1 完了後に運用 SOP として `docs/Yahoo/運用ガイド.md` に転載する。

---

## 4. データモデル変更

### models.py の変更

[src/product_register/models.py](../../../src/product_register/models.py) の `ProductInput` に **3 列追加**（全てデフォルト値ありの optional）。

```python
class ProductInput(BaseModel):
    # …既存フィールドはそのまま…

    # Yahoo セット集約用 (新規追加)
    unit: str = ""                        # 単位 (例: "本", "袋", "個", "枚")
    yahoo_grouping_enabled: bool = False  # grouping を有効にするか
    yahoo_variation_title: str = ""       # variation1-free-title (例: "数量")
```

### reader.py の変更（bool 変換）

[src/product_register/reader.py](../../../src/product_register/reader.py) は現状、空文字列をそのまま Pydantic に渡している (`cleaned[key.strip()] = value.strip() if value else ""`)。

`yahoo_grouping_enabled: bool` への CSV 値 `""` / `"TRUE"` / `"FALSE"` を安全に変換するため、以下を追加:

```python
def _parse_bool(v: str) -> bool:
    """CSV の文字列を bool に変換。空文字列は False。"""
    if not v:
        return False
    return v.strip().upper() in ("TRUE", "1", "YES", "Y")

# read_input_csv 内で:
bool_fields = ("yahoo_grouping_enabled",)
for f in bool_fields:
    if f in cleaned:
        cleaned[f] = _parse_bool(cleaned[f])
```

→ 既存 CSV (3 列が未追加) を流しても、`yahoo_grouping_enabled` キーが存在しないので Pydantic のデフォルト値 `False` が適用され、後方互換性が保たれる。

### バリデーション方針

`yahoo_grouping_enabled=True` の場合に `unit` / `yahoo_variation_title` が空でもエラーにせず、Converter 側で **警告ログを出す**:

```python
if p.yahoo_grouping_enabled and not p.unit:
    logger.warning(f"ne_code={p.ne_code}: yahoo_grouping_enabled=True だが unit が空。"
                   f"variation1-name が壊れた値 '{quantity}{unit}セット' になる可能性")
```

理由: バリデーションをエラーにすると CSV 一括処理が止まる。警告で気付かせる方が運用しやすい。

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

## 5. Yahoo Converter ロジック設計

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

### 値を入れる列 (今回スコープ) — 既存 21 列 + 新規 4 列 = 計 25 列

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
| `taxrate-type` | `str(tax_rate / 100)` （`tax_rate∈{8, 10}` の前提なので `"0.08"` か `"0.1"` のみ。⚠ Yahoo 仕様で `"0.10"` 表記が要求される場合は不一致になるため、アップロード前に Yahoo 管理画面で要確認） |
| `lead-time-instock` | `str(lead_time)` |
| `lead-time-outstock` | `str(lead_time)` |
| `keep-stock` | `"1"` |
| **`grouping-id`** (新規) | `_resolve_grouping_id(ne_code, yahoo_grouping_enabled)` |
| **`variation1-free-title`** (新規) | `yahoo_variation_title` if `yahoo_grouping_enabled` else `""` |
| **`variation1-name`** (新規) | `_build_variation_name(quantity, unit)` if `yahoo_grouping_enabled` else `""` |
| **`item-image-urls`** (新規) | `_build_item_image_urls(ne_code, image_count)` |
| `variation1-spec-id` | 常に `""` (フリータイトル方式、添付CSVの実例に準拠) |
| variation2-5 系 9 列 | 常に `""` |
| 残り 51 列 | 全て `""` |

### 主要ヘルパー関数

**既存ヘルパーは流用** — `_build_caption(ne_code, image_count, description_pc)` と `_build_explanation(free1, description_pc)` は現状の [src/product_register/converters/yahoo.py](../../../src/product_register/converters/yahoo.py) のロジックをそのまま使う（シグネチャ・戻り値ともに変更なし）。新規追加は以下の 3 関数のみ。

```python
import re

def _resolve_grouping_id(ne_code: str, enabled: bool) -> str:
    """yahoo_grouping_enabled=True のとき ne_code 末尾の -数字のみ を取り除く。

    末尾が「ハイフン + 数字のみ」のときだけ trim する。S01 のように英字を含む
    場合は ne_code そのまま返す（rsplit + isdigit() で実現）。

    例:
        t002-2542-1   → t002-2542  (-1 を取り除く)
        n019-0250-10  → n019-0250  (-10 を取り除く)
        t002-2542-S01 → t002-2542-S01 (S を含むため trim しない)
        noni6         → noni6 (ハイフンなしのためそのまま)
    """
    if not enabled:
        return ""
    parts = ne_code.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0]
    return ne_code


def _build_variation_name(quantity: int, unit: str) -> str:
    """quantity と unit から表示名を生成。

    例:
        quantity=1, unit="袋" → "1袋"
        quantity=5, unit="袋" → "5袋セット"
        quantity=1, unit=""   → "1"  (壊れた表示、警告ログを出す側で検知)
        quantity=5, unit=""   → "5セット"  (同上)
    """
    if quantity == 1:
        return f"1{unit}"
    return f"{quantity}{unit}セット"


def _build_item_image_urls(ne_code: str, image_count: int) -> str:
    """画像URL をセミコロン区切りで生成。

    1枚目: {base}/{ne_code}.jpg
    N≥2: {base}/{ne_code}_{N}.jpg

    例:
        image_count=0 → ""
        image_count=1 → ".../{ne_code}.jpg"
        image_count=3 → ".../{ne_code}.jpg;.../{ne_code}_2.jpg;.../{ne_code}_3.jpg"
    """
    if image_count <= 0:
        return ""
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
| **variation1-spec-id** | (空) | (空) | (空) |
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

## 6. テスト戦略

### 既存テスト ([tests/test_yahoo.py](../../../tests/test_yahoo.py)) の更新

- `test_yahoo_42_columns` → `test_yahoo_85_columns` にリネーム + 期待値変更
- 既存 13 テストは変更なしで通る想定（code/name/price/headline/explanation/caption/sp-additional/delivery系/taxable/taxrate-type/lead-time/postage-set はロジック変更なし）

### 新規テストケース（13件）

| テスト | 検証内容 |
|---|---|
| `test_yahoo_85_columns` | 列数が 85 |
| `test_yahoo_column_order` | カラム順が添付CSVと完全一致 |
| `test_yahoo_grouping_id_auto` | `t002-2542-3` (quantity=3, enabled=True) → `grouping-id=t002-2542` |
| `test_yahoo_grouping_id_disabled` | `yahoo_grouping_enabled=False` → `grouping-id=""` |
| `test_yahoo_grouping_id_S01_preserved` | `ne_code="t002-2542-S01"`, enabled=True → `grouping-id="t002-2542-S01"`（trim されない） |
| `test_yahoo_variation1_spec_id_always_empty` | variation1-spec-id は常に `""` |
| `test_yahoo_variation1_title` | `yahoo_variation_title="数量"`, enabled=True → そのまま出力 |
| `test_yahoo_variation1_name_single` | quantity=1, unit="袋" → `"1袋"` |
| `test_yahoo_variation1_name_set` | quantity=5, unit="袋" → `"5袋セット"` |
| `test_yahoo_variation1_empty_when_disabled` | grouping=False のときは variation1-free-title / variation1-name 共に空 |
| `test_yahoo_variation2_through_5_empty` | variation2〜5 系 9 列は常に空 |
| `test_yahoo_item_image_urls` | image_count=3 → 3 URL セミコロン区切り、1枚目はサフィックスなし |
| `test_yahoo_item_image_urls_count_1` | image_count=1 → URL 1 件のみ、セミコロンなし |
| `test_yahoo_item_image_urls_count_0` | image_count=0 → `""`（空文字列） |

### conftest.py の `make_product` 更新

`make_product` のデフォルトは **grouping を OFF** にして既存テストへの波及を最小化する。grouping を検証するテストでは個別に `yahoo_grouping_enabled=True` を明示する:

```python
defaults = dict(
    # …既存…
    unit="本",
    yahoo_grouping_enabled=False,    # ← デフォルト OFF（既存テストの出力が変わらない）
    yahoo_variation_title="数量",
)
```

例:
```python
# grouping を検証するテストは明示的に True にする
def test_yahoo_grouping_id_auto():
    conv = YahooConverter()
    rows = conv.convert([make_product(
        ne_code="t002-2542-3", quantity=3,
        yahoo_grouping_enabled=True,
    )])
    assert rows[0]["grouping-id"] == "t002-2542"
```

### reader.py のテスト追加（tests/test_reader.py）

| テスト | 検証内容 |
|---|---|
| `test_read_csv_yahoo_grouping_enabled_TRUE` | CSV値 `"TRUE"` → `bool True` |
| `test_read_csv_yahoo_grouping_enabled_FALSE` | CSV値 `"FALSE"` → `bool False` |
| `test_read_csv_yahoo_grouping_enabled_empty` | CSV値 `""` → `bool False`（後方互換） |
| `test_read_csv_backward_compat` | 既存 CSV (3 列未追加) を読み込んでも ProductInput 構築成功 |

### 期待値 CSV ([tests/fixtures/expected/yahoo.csv](../../../tests/fixtures/expected/yahoo.csv))

7商品 × 42列 → 7商品 × 85列に再生成。期待値は **添付 CSV ノニジュース 5 行を Reference として、grouping-id / variation1-free-title / variation1-name の値が同じパターンになることを手動で事前確認**してから固定する。実装後の出力を盲目的に期待値化するのではなく、**Reference 値との比較で目視チェックを通したものを期待値として確定する**。

### 統合テスト ([tests/test_integration.py](../../../tests/test_integration.py))

`test_yahoo_matches_excel_output` 相当のテストで、`compare_csv` の比較キーは `code` 単一キーを継続使用（grouping-id は重複しても `code` は一意）。

加えて以下のクロスチェック assert を追加:

```python
def test_yahoo_grouping_consistency():
    """同一 grouping-id を持つ行が path / display / explanation / image_count の意味で
    Yahoo 集約として正しい構造になっていることを保証する。"""
    products = read_input_csv(FIXTURES / "input_sample.csv")
    rows = YahooConverter().convert(products)

    # n019-0250 グループ
    chinsuko = [r for r in rows if r["grouping-id"] == "n019-0250"]
    assert len(chinsuko) == 3, "n019-0250 グループは 3 商品 (1袋/5袋/10袋)"
    variation_names = {r["variation1-name"] for r in chinsuko}
    assert variation_names == {"1袋", "5袋セット", "10袋セット"}
    # 集約商品は path / display が同一でなければならない (Yahoo 仕様)
    paths = {r["path"] for r in chinsuko}
    assert len(paths) == 1, "集約商品の path は同一"

    # t002-2542 グループ
    giants = [r for r in rows if r["grouping-id"] == "t002-2542"]
    assert len(giants) == 2
    assert {r["variation1-name"] for r in giants} == {"1本", "3本セット"}
```

---

## 7. 完了基準

すべて自動テストで判定可能:

- [ ] `pytest tests/` が全件パス（既存 79件 + 新規 14件 Yahoo + 新規 4件 reader = 97件）
- [ ] `product-register convert tests/fixtures/input_sample.csv -o ./output/` が成功し、`output/yahoo.csv` が 85列形式で生成される
- [ ] `product-register verify ./output/ ./tests/fixtures/expected/` で `mismatched_rows == 0`
- [ ] `test_yahoo_grouping_consistency` 統合テストで grouping-id の集約構造が assert で確認される
- [ ] 警告ログ: `yahoo_grouping_enabled=True` かつ `unit=""` の商品があれば WARNING が記録される

### 運用検証（Phase 1 完了後の手動チェック項目）

- [ ] Yahoo テストストアに 1 グループ（3 商品）を実際にアップロードし、Yahoo 管理画面で「数量」セレクタが動作することを目視確認
- [ ] 既存登録商品との上書き挙動の事前確認 SOP を `docs/Yahoo/運用ガイド.md` に記述

---

## 8. リスクと未解決事項

| リスク | 対処 |
|---|---|
| 既存登録商品の他項目が空欄上書きされる可能性 | Phase 1 では新規商品のみで採用、Phase 2 で「差分アップロード」運用 |
| `variation1-spec-id` 空運用が Yahoo CSV 仕様で恒久的に許容される保証なし | 添付CSV (data_input202605122227.csv) で動作実績ありを根拠とするが、Yahoo 仕様変更で動作不能になるリスクあり。アップロード前に Yahoo 管理画面で確認 |
| `unit` を空にした商品で variation1-name が「5セット」と壊れる | 警告ログで気付ける、運用 SOP で「grouping=TRUE のときは必ず unit を入力する」を明記 |
| 異種セット (-S01) は今回 grouping されず個別商品扱い | Phase 2 で「異種セット集約 (variation1=構成品)」を別途設計 |
| `taxrate-type` の `"0.1"` 表記が Yahoo 仕様の `"0.10"` 要求と食い違う可能性 | アップロード前に Yahoo 管理画面でテスト商品登録し、エラー有無を確認 |
