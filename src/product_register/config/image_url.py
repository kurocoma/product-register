def generate_rakuten_image_urls(ne_code: str, image_count: int) -> list[str]:
    """楽天R-Cabinet画像URLを商品コード+枚数から生成"""
    base = f"https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/{ne_code}"
    urls = []
    for i in range(1, image_count + 1):
        suffix = "" if i == 1 else f"_{i}"
        urls.append(f"{base}{suffix}.jpg")
    return urls
