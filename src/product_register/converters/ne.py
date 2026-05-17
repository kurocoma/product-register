from __future__ import annotations
import re
from product_register.converters.base import BaseConverter
from product_register.models import ProductInput

_RAKUTEN_IMAGE_BASE = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02"


def _extract_sire_code(maker_code: str) -> str:
    """maker_code の数字部分だけを返す。例: 't002' -> '002', 'n019' -> '019'"""
    return re.sub(r"[^0-9]", "", maker_code)


def _strip_trailing_suffix(ne_code: str) -> str:
    """ne_code の末尾の '-数字' を除いたベースコードを返す。
    例: 't002-2542-1' -> 't002-2542', 't002-2542-3' -> 't002-2542'
    """
    return re.sub(r"-\d+$", "", ne_code)


def _single_code_from_set_code(ne_code: str) -> str:
    """セット商品コードから単品コードを導出する。
    例: 't002-2542-3' -> 't002-2542-1'（末尾の '-数字' を '-1' に置換）
    """
    return re.sub(r"-\d+$", "-1", ne_code)


def _build_img_list_html(ne_code: str, image_count: int) -> str:
    """setumei2/setumei4 用の imgList HTML を生成する（<br> あり）。
    画像は {ne_code}_2.jpg から {ne_code}_{image_count}.jpg まで。
    """
    if image_count <= 1:
        return ""
    imgs = "".join(
        f'<img src="{_RAKUTEN_IMAGE_BASE}/{ne_code}_{i}.jpg" width="100%"><br>'
        for i in range(2, image_count + 1)
    )
    return f"<!--imgList-->{imgs}<!--/imgList-->"


def _build_gazou_urls_single(ne_code: str, image_count: int, image_url_20: str) -> dict:
    """単品の gazou_url1〜20 を生成する。
    - gazou_url1: ne_code.jpg
    - gazou_url2〜N: base_code_{i}.jpg (末尾サフィックスを除いたベースコード)
    - gazou_url20: image_url_20 (入力値をそのまま使用)
    """
    base_code = _strip_trailing_suffix(ne_code)
    result = {f"gazou_url{i}": "" for i in range(1, 21)}
    result["gazou_url1"] = f"{_RAKUTEN_IMAGE_BASE}/{ne_code}.jpg"
    for i in range(2, image_count + 1):
        result[f"gazou_url{i}"] = f"{_RAKUTEN_IMAGE_BASE}/{base_code}_{i}.jpg"
    if image_url_20:
        result["gazou_url20"] = image_url_20
    return result


def _build_gazou_urls_set(ne_code: str, image_count: int, image_url_20: str) -> dict:
    """セット商品の gazou_url1〜20 を生成する。
    - gazou_url1: ne_code.jpg
    - gazou_url2〜N: ne_code_{i}.jpg (フルコードを使用)
    - gazou_url20: image_url_20 (入力値をそのまま使用)
    """
    result = {f"gazou_url{i}": "" for i in range(1, 21)}
    result["gazou_url1"] = f"{_RAKUTEN_IMAGE_BASE}/{ne_code}.jpg"
    for i in range(2, image_count + 1):
        result[f"gazou_url{i}"] = f"{_RAKUTEN_IMAGE_BASE}/{ne_code}_{i}.jpg"
    if image_url_20:
        result["gazou_url20"] = image_url_20
    return result


def _soryo_kbn(shipping_type: str) -> str:
    """送料区分コードを返す。送料無料 → '2'、それ以外 → '1'"""
    return "2" if shipping_type == "送料無料" else "1"


class NEConverter(BaseConverter):
    """Next Engine 用コンバーター。単品リストとセット商品リストの2つを返す。"""

    mall_name = "ne"
    encoding = "utf-8"  # BOM 付きだと列名先頭に BOM が混入し必須列を見失うため BOM なし

    def convert(self, products: list[ProductInput]) -> tuple[list[dict], list[dict]]:  # type: ignore[override]
        """ProductInputリストを (単品rows, セット商品rows) のタプルに変換する。"""
        singles: list[dict] = []
        sets: list[dict] = []

        for p in products:
            if p.is_single:
                singles.append(self._map_single(p))
            else:
                sets.append(self._map_set(p))

        return singles, sets

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _map_single(self, p: ProductInput) -> dict:
        # image_url_http: 設定済みの場合はそのまま、なければ Rakuten 画像 URL から自動生成
        if p.image_url_1:
            image_url = p.image_url_1
        else:
            image_url = f"{_RAKUTEN_IMAGE_BASE}/{p.ne_code}.jpg"

        # 画像リスト HTML (setumei2 / setumei4)
        img_list = _build_img_list_html(p.ne_code, p.image_count)
        setumei2 = (img_list + "\n" + p.description_pc) if img_list else p.description_pc

        # gazou_url1〜20
        gazou = _build_gazou_urls_single(p.ne_code, p.image_count, p.image_url_20)

        # 税込価格 (free4)
        tax_inclusive = int(p.selling_price * (1 + p.tax_rate / 100))

        row: dict = {
            "syohin_code": p.ne_code,
            "sire_code": _extract_sire_code(p.maker_code),
            "syohin_name": p.product_name,
            "baika_tnk": str(p.selling_price),
            "tax_rate": str(p.tax_rate),
            "toriatukai_kbn": "0",
            "genka_tnk": str(p.cost_price),
            "jan_code": p.jan_code,
            "daihyo_syohin_code": "",
            "image_url_http": image_url,
            "hyoji_tnk": "",
            "zei_kbn": "0",
            "package_haba": "",
            "package_okuyuki": "",
            "package_takasa": "",
            "package_omosa": "",
            "hasou_kikan_kbn": "",
            "size": "",
            "gift_ok_flg": "",
            "noshi_kbn": "",
            "iro": "",
            "brand_name": p.brand_name,
            "maker_kataban": "",
            "maker_name": p.maker_name,
            "hanbai_kaisi_bi": "",
            "hanbai_syuryo_bi": "",
            "kataban": "",
            "location": "",
            "syohin_jyotai_kbn": "",
            "syohin_jyotai_setumei": "",
            "page_syohin_name": p.display_name,
            "soryo_kbn": _soryo_kbn(p.shipping_type),
            "display": "1",
            "catch_copy1": p.catch_copy_pc,
            "catch_copy2": "",
            "setumei1": p.description_pc,
            "setumei2": setumei2,
            "setumei3": "",
            "setumei4": img_list,
            "setumei5": "",
            "setumei6": "",
            "setumei7": "",
            "setumei8": "",
            "setumei9": "",
            "setumei10": "",
            "keyword": p.keyword,
        }
        row.update(gazou)
        row.update({
            "sentakusi_yoko_name": "",
            "spec1": str(p.delivery_method),
            "spec2": str(p.lead_time),
            "spec3": f"{p.delivery_method}営業日出荷",
            "spec4": "",
            "spec5": "",
            "free1": p.free1,
            "free2": p.free2,
            "free3": str(p.lead_time),
            "free4": str(tax_inclusive),
            "free5": p.catch_copy_pc,
            "free6": "",
            "free7": "",
            "free8": "",
            "free9": "",
            "free10": "",
            "tenpo_kihon_category1": p.store_category,
            "tenpo_kihon_category2": "",
            "tenpo_kihon_category3": "",
            "tenpo_kihon_category4": "",
            "tenpo_kihon_category5": "",
            "tenpo_kihon_category6": "",
            "tenpo_kihon_category7": "",
            "tenpo_kihon_category8": "",
            "tenpo_kihon_category9": "",
            "tenpo_kihon_category10": "",
            "moru_kihon_category_code": p.mall_category_id,
            "zaiko_su_hyoji_kbn": "0",
        })
        return row

    def _map_set(self, p: ProductInput) -> dict:
        single_code = _single_code_from_set_code(p.ne_code)

        # 画像リスト HTML (setumei2 / setumei4) — セット商品はフルコードを使用
        img_list = _build_img_list_html(p.ne_code, p.image_count)
        setumei2 = (img_list + "\n" + p.description_pc) if img_list else p.description_pc

        # gazou_url1〜20
        gazou = _build_gazou_urls_set(p.ne_code, p.image_count, p.image_url_20)

        # 税込価格 (free4)
        tax_inclusive = int(p.selling_price * (1 + p.tax_rate / 100))

        row: dict = {
            "set_syohin_code": p.ne_code,
            "set_syohin_name": p.product_name,
            "set_baika_tnk": str(p.selling_price),
            "tax_rate": str(p.tax_rate),
            "syohin_code": single_code,
            "suryo": str(p.quantity),
            "jan_code": p.jan_code,
            "daihyo_syohin_code": "",
            "hyoji_tnk": "",
            "zei_kbn": "0",
            "package_haba": "",
            "package_okuyuki": "",
            "package_takasa": "",
            "package_omosa": "",
            "hasou_kikan_kbn": "",
            "size": "",
            "gift_ok_flg": "",
            "noshi_kbn": "",
            "iro": "",
            "brand_name": p.brand_name,
            "maker_kataban": "",
            "maker_name": p.maker_name,
            "hanbai_kaisi_bi": "",
            "hanbai_syuryo_bi": "",
            "kataban": "",
            "location": "",
            "syohin_jyotai_kbn": "",
            "syohin_jyotai_setumei": "",
            "page_syohin_name": p.display_name,
            "soryo_kbn": _soryo_kbn(p.shipping_type),
            "display": "1",
            "catch_copy1": p.catch_copy_pc,
            "catch_copy2": "",
            "setumei1": p.description_pc,
            "setumei2": setumei2,
            "setumei3": "",
            "setumei4": img_list,
            "setumei5": "",
            "setumei6": "",
            "setumei7": "",
            "setumei8": "",
            "setumei9": "",
            "setumei10": "",
            "keyword": p.keyword,
        }
        row.update(gazou)
        row.update({
            "sentakusi_yoko_name": p.option_item_name,
            "spec1": str(p.delivery_method),
            "spec2": str(p.lead_time),
            "spec3": f"{p.delivery_method}営業日出荷",
            "spec4": "",
            "spec5": "",
            "free1": p.free1,
            "free2": p.free2,
            "free3": str(p.quantity),
            "free4": str(tax_inclusive),
            "free5": p.catch_copy_pc,
            "free6": "",
            "free7": "",
            "free8": "",
            "free9": "",
            "free10": "",
            "tenpo_kihon_category1": p.store_category,
            "tenpo_kihon_category2": "",
            "tenpo_kihon_category3": "",
            "tenpo_kihon_category4": "",
            "tenpo_kihon_category5": "",
            "tenpo_kihon_category6": "",
            "tenpo_kihon_category7": "",
            "tenpo_kihon_category8": "",
            "tenpo_kihon_category9": "",
            "tenpo_kihon_category10": "",
            "moru_kihon_category_code": p.mall_category_id,
            "zaiko_su_hyoji_kbn": "0",
        })
        return row
