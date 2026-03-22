from abc import ABC, abstractmethod
from product_register.models import ProductInput

class BaseConverter(ABC):
    mall_name: str

    @abstractmethod
    def convert(self, products: list[ProductInput]) -> list[dict]:
        """ProductInputリストを、モール用の辞書リスト(=CSV行)に変換する"""
        ...
