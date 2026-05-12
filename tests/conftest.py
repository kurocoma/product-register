import pytest
from product_register.models import ProductInput

def make_product(**overrides) -> ProductInput:
    """テスト用の商品データファクトリ。全テストファイルから使用する。"""
    defaults = dict(
        ne_code="t002-2542-1", jan_code="4955028002542", maker_code="t002",
        product_type="単品", quantity=1,
        product_name="GIANTSボトル 10年貯蔵古酒 720ml 25度",
        display_name="巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
        tax_rate=10, cost_price=0, selling_price=10000,
        shipping_type="送料無料", image_count=3, delivery_method=4,
        lead_time=1, mall_category_id="402930", store_category="沖縄のお酒",
        yahoo_category_id="41383", yahoo_path="沖縄のお酒",
        catch_copy_pc="毎年完売必須 プロ野球 人気のボトル",
        catch_copy_yahoo="毎年完売 プロ野球ボトル",
        unit="本",
        yahoo_grouping_enabled=False,
        yahoo_variation_title="数量",
    )
    defaults.update(overrides)
    return ProductInput(**defaults)
