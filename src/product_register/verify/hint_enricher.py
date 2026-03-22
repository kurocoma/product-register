"""ドメイン知識に基づくhint生成。"""

KNOWN_PATTERNS: dict[str, list[dict]] = {
    "rakuten": [
        {"column": "消費税率", "hint": "消費税率の変換: 入力値(10) → 出力値(0.1)。tax_rate / 100 が必要"},
        {"column": "属性", "hint": "単品→'親', セット商品→'子' のマッピング"},
        {"column": "倉庫指定", "hint": "親行のみ値を設定（0）、子行は空文字"},
        {"column": "サーチ表示", "hint": "親行のみ値を設定（1）、子行は空文字"},
    ],
    "yahoo": [
        {"column": "taxrate_type", "hint": "税率変換: 入力値(10) → 出力値(0.1)。tax_rate / 100 が必要"},
    ],
    "ne": [
        {"column": "sire_code", "hint": "sire_code ← maker_code のマッピング"},
    ],
    "shopify": [
        {"column": "Image Position", "hint": "画像行ごとに1始まりで自動採番"},
        {"column": "Status", "hint": "Status は 'active' 固定"},
    ],
}

def enrich_hint(mall: str, column: str, expected: str, actual: str) -> str:
    patterns = KNOWN_PATTERNS.get(mall, [])
    for p in patterns:
        if p["column"] == column:
            return p["hint"]
    return f"Column '{column}': expected '{expected}' but got '{actual}'"
