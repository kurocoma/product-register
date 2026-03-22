from __future__ import annotations

from collections import defaultdict

from product_register.converters.base import BaseConverter
from product_register.models import ProductInput


# ---------------------------------------------------------------------------
# Lead-time display text mapping (delivery_method value → "N営業日出荷")
# ---------------------------------------------------------------------------
def _lead_time_label(delivery_method: int) -> str:
    return f"{delivery_method}営業日出荷"


# ---------------------------------------------------------------------------
# Shipping flag for SKU row: 送料無料 → 1 (送料区分なし/無料), 送料別 → 0 (送料区分を使用)
# ---------------------------------------------------------------------------
def _soryo(shipping_type: str) -> int:
    return 1 if shipping_type == "送料無料" else 0


# ---------------------------------------------------------------------------
# Base code: maker_code + "-" + last 4 digits of jan_code
# e.g. maker_code="t002", jan_code="4955028002542" → "t002-2542"
# ---------------------------------------------------------------------------
def _base_code(p: ProductInput) -> str:
    jan_suffix = p.jan_code[-4:]
    return f"{p.maker_code}-{jan_suffix}"


def _normalize_rows(rows: list[dict]) -> list[dict]:
    """Ensure all rows share the same set of keys (union of all rows' keys),
    filling missing values with empty string. Key order is preserved from the
    first row, with any additional keys from later rows appended at the end.
    """
    if not rows:
        return rows

    all_keys: list[str] = list(rows[0].keys())
    seen: set[str] = set(all_keys)
    for row in rows[1:]:
        for k in row:
            if k not in seen:
                all_keys.append(k)
                seen.add(k)

    return [{k: row.get(k, "") for k in all_keys} for row in rows]


class RakutenConverter(BaseConverter):
    mall_name = "rakuten"

    def convert(self, products: list[ProductInput]) -> list[dict]:
        """ProductInputリストを楽天CSV用の辞書リストに変換する。

        商品は base_code（maker_code + JAN下4桁）でグループ化される。
        各グループに1つの親行と、SKUごとの子行を出力する。
        並び順: base_code 昇順
        """
        # Group by base_code, preserving insertion order within each group
        groups: dict[str, list[ProductInput]] = defaultdict(list)
        for p in products:
            groups[_base_code(p)].append(p)

        rows: list[dict] = []
        for base in sorted(groups.keys()):
            members = groups[base]
            # Use the single (単品) product as the representative for parent info;
            # fall back to the first product if no single exists.
            representative = next((p for p in members if p.is_single), members[0])

            rows.append(self._build_parent_row(base, representative, members))
            for p in members:
                rows.append(self._build_child_row(base, p))

        return _normalize_rows(rows)

    # ------------------------------------------------------------------
    # Parent row (one per base_code group)
    # ------------------------------------------------------------------

    def _build_parent_row(
        self,
        base: str,
        rep: ProductInput,
        members: list[ProductInput],
    ) -> dict:
        row: dict = {}

        row["商品管理番号（商品URL）"] = base
        row["商品番号"] = base
        row["商品名"] = rep.display_name

        row["倉庫指定"] = 0
        row["サーチ表示"] = 1
        row["消費税"] = 0
        row["消費税率"] = str(rep.tax_rate / 100)

        # Buttons / display (fixed values)
        row["注文ボタン"] = 1
        row["商品問い合わせボタン"] = 1
        row["在庫表示"] = -1
        row["代引料"] = 0

        # Category
        row["ジャンルID"] = rep.mall_category_id

        # Copy / description
        row["キャッチコピー"] = rep.catch_copy_pc
        row["PC用商品説明文"] = rep.description_pc
        row["スマートフォン用商品説明文"] = rep.description_sp
        row["PC用販売説明文"] = rep.description_sp

        # Parent images (CABINET paths, no full URL)
        # Image 1 uses the representative (single) product ne_code
        # Images 2+ use base_code
        row["商品画像タイプ1"] = "CABINET"
        row["商品画像パス1"] = f"/thum02/{rep.ne_code}.jpg"
        for i in range(2, rep.image_count + 1):
            row[f"商品画像タイプ{i}"] = "CABINET"
            row[f"商品画像パス{i}"] = f"/thum02/{base}_{i}.jpg"
        # Fill unused image slots as empty
        for i in range(max(2, rep.image_count + 1), 21):
            row[f"商品画像タイプ{i}"] = ""
            row[f"商品画像パス{i}"] = ""
        # image_count=1 means no _2+ images - still fill slots 2–20
        if rep.image_count == 1:
            for i in range(2, 21):
                row[f"商品画像タイプ{i}"] = ""
                row[f"商品画像パス{i}"] = ""

        # White background image
        row["白背景画像タイプ"] = "CABINET"
        row["白背景画像パス"] = f"/wb01/wb-{base}.jpg"

        # Layout / display settings (fixed)
        row["商品情報レイアウト"] = 1
        row["ヘッダー・フッター・レフトナビ"] = "自動選択"
        row["表示項目の並び順"] = "自動選択"
        row["共通説明文（小）"] = "自動選択"
        row["目玉商品"] = "自動選択"
        row["共通説明文（大）"] = "自動選択"
        row["レビュー本文表示"] = 2
        row["メーカー提供情報表示"] = 1
        row["定期購入ボタン"] = 0

        # Variation definition (from representative product)
        row["バリエーション項目キー定義"] = rep.variation_key
        row["バリエーション項目名定義"] = rep.variation_name
        row["バリエーション1選択肢定義"] = rep.variation_choices

        return row

    # ------------------------------------------------------------------
    # Child row (one per ProductInput / SKU)
    # ------------------------------------------------------------------

    def _build_child_row(self, base: str, p: ProductInput) -> dict:
        row: dict = {}

        row["商品管理番号（商品URL）"] = base

        # SKU identification
        row["SKU管理番号"] = p.ne_code
        row["システム連携用SKU番号"] = p.ne_code

        # Variation selection
        row["バリエーション項目キー1"] = p.variation_key
        row["バリエーション項目選択肢1"] = p.option_item_name

        # Pricing
        row["販売価格"] = str(p.selling_price)
        row["表示価格"] = str(p.selling_price)
        row["二重価格文言管理番号"] = 1

        # Inventory / buttons
        row["再入荷お知らせボタン"] = 0
        row["のし対応"] = 0
        row["在庫数"] = 10
        row["在庫戻しフラグ"] = 1
        row["在庫切れ時の注文受付"] = 0

        # Delivery
        label = _lead_time_label(p.delivery_method)
        row["在庫あり時納期管理番号"] = 1
        row["在庫切れ時納期管理番号"] = 1
        row["在庫あり時出荷リードタイム"] = label
        row["在庫切れ時出荷リードタイム"] = label
        row["配送リードタイム"] = "自社倉庫"
        row["SKU倉庫指定"] = 0
        row["送料"] = _soryo(p.shipping_type)
        row["単品配送設定使用"] = 0

        # Catalog
        row["カタログID"] = p.jan_code

        # SKU image
        row["SKU画像タイプ"] = "CABINET"
        row["SKU画像パス"] = f"/thum02/{p.ne_code}.jpg"

        # 商品属性 (1〜5)
        for i in range(1, 6):
            item_val = getattr(p, f"attribute_item_{i}", "")
            value_val = getattr(p, f"attribute_value_{i}", "")
            unit_val = getattr(p, f"attribute_unit_{i}", "")

            row[f"商品属性（項目）{i}"] = item_val
            row[f"商品属性（値）{i}"] = value_val
            row[f"商品属性（単位）{i}"] = "" if unit_val == "0" else unit_val

        return row
