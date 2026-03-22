from __future__ import annotations
from pydantic import BaseModel, field_validator

class ProductInput(BaseModel):
    """統一入力フォーマットのデータモデル"""
    # 基本情報
    ne_code: str
    jan_code: str
    maker_code: str
    product_type: str  # "単品" or "セット商品"
    quantity: int
    product_name: str
    display_name: str
    tax_rate: int  # 8 or 10
    cost_price: int = 0
    selling_price: int

    # 配送・カテゴリ
    shipping_type: str  # "送料別" or "送料無料"
    image_count: int
    delivery_method: int
    lead_time: int
    mall_category_id: str
    store_category: str = ""

    # 商品説明
    catch_copy_pc: str = ""
    catch_copy_yahoo: str = ""
    description_pc: str = ""
    description_sp: str = ""
    description_4: str = ""
    free1: str = ""
    free2: str = ""
    keyword: str = ""
    maker_name: str = ""
    brand_name: str = ""

    # Yahoo固有
    yahoo_category_id: str = ""   # Yahoo用カテゴリID (e.g., "41383", "20946")
    yahoo_path: str = ""          # Yahoo用店舗内カテゴリパス (e.g., "沖縄のお酒")

    # バリエーション
    option_item_name: str = ""
    option_horizontal: str = ""
    variation_key: str = ""
    variation_name: str = ""
    variation_choices: str = ""
    choice_numbers: str = ""

    # 画像URL (1〜20)
    image_url_1: str = ""
    image_url_2: str = ""
    image_url_3: str = ""
    image_url_4: str = ""
    image_url_5: str = ""
    image_url_6: str = ""
    image_url_7: str = ""
    image_url_8: str = ""
    image_url_9: str = ""
    image_url_10: str = ""
    image_url_11: str = ""
    image_url_12: str = ""
    image_url_13: str = ""
    image_url_14: str = ""
    image_url_15: str = ""
    image_url_16: str = ""
    image_url_17: str = ""
    image_url_18: str = ""
    image_url_19: str = ""
    image_url_20: str = ""

    # 商品属性 (1〜5)
    attribute_item_1: str = ""
    attribute_value_1: str = ""
    attribute_unit_1: str = ""
    attribute_item_2: str = ""
    attribute_value_2: str = ""
    attribute_unit_2: str = ""
    attribute_item_3: str = ""
    attribute_value_3: str = ""
    attribute_unit_3: str = ""
    attribute_item_4: str = ""
    attribute_value_4: str = ""
    attribute_unit_4: str = ""
    attribute_item_5: str = ""
    attribute_value_5: str = ""
    attribute_unit_5: str = ""

    @field_validator("tax_rate")
    @classmethod
    def validate_tax_rate(cls, v: int) -> int:
        if v not in (8, 10):
            raise ValueError(f"tax_rate must be 8 or 10, got {v}")
        return v

    @field_validator("jan_code")
    @classmethod
    def validate_jan_code(cls, v: str) -> str:
        if len(v) != 13 or not v.isdigit():
            raise ValueError(f"jan_code must be 13 digits, got '{v}'")
        return v

    @property
    def is_single(self) -> bool:
        return self.product_type == "単品"

    @property
    def is_set(self) -> bool:
        return self.product_type == "セット商品"

    def get_image_urls(self) -> list[str]:
        """設定済みの画像URLリストを返す"""
        urls = []
        for i in range(1, 21):
            url = getattr(self, f"image_url_{i}")
            if url:
                urls.append(url)
        return urls
