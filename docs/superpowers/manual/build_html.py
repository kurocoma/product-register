"""Markdown → HTML 変換スクリプト"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Windows PowerShell でも UTF-8 で標準出力できるよう設定
if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import markdown

ROOT = Path(__file__).parent

DOCS = [
    {
        "src": "要件定義書.md",
        "dst": "要件定義書.html",
        "title": "商品登録アプリ 要件定義書",
        "subtitle": "5モール EC 商品一括登録アプリ — Phase 1 完了時点",
        "current_nav": "requirements",
        # (見出し検出キーワード, 画像パス, キャプション)
        "image_inserts": [
            ("プロジェクト概要",
             "images/01-overall-flow.png",
             "図 1: 商品登録アプリの全体フロー (入力 → 変換 → 出力 → 検証)"),
            ("Yahoo セット商品の集約",
             "images/02-yahoo-grouping.png",
             "図 2: 同一 JAN の単品/セット商品を grouping-id で 1 ページに集約"),
        ],
    },
    {
        "src": "詳細設計書.md",
        "dst": "詳細設計書.html",
        "title": "商品登録アプリ Phase 1 詳細設計書",
        "subtitle": "CSV 出力 CLI ツール 実装詳細",
        "current_nav": "design",
        "image_inserts": [
            ("アーキテクチャ概要",
             "images/01-overall-flow.png",
             "図 1: 全体フロー (Reader → Converter → Writer → Verify)"),
            ("4.3 Yahoo Converter",
             "images/02-yahoo-grouping.png",
             "図 2: Yahoo セット商品集約の仕組み"),
            ("convert",
             "images/03-convert-step.png",
             "図 3: convert コマンドの実行手順"),
            ("verify",
             "images/04-verify-step.png",
             "図 4: verify コマンドの実行手順"),
        ],
    },
]

HEADING_RE = re.compile(r"<h([1-4])([^>]*)>(.*?)</h\1>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")


def strip_tags(html: str) -> str:
    return TAG_RE.sub("", html)


def insert_images(html: str, inserts: list[tuple[str, str, str]]) -> str:
    """指定キーワードを含む最初の見出しの直後に <figure> を挿入する。"""
    matches = list(HEADING_RE.finditer(html))
    used_indices: set[int] = set()
    inserts_with_pos: list[tuple[int, str]] = []  # (insert_position, figure_html)

    for keyword, img_path, caption in inserts:
        figure_html = (
            f'\n<figure class="figure">\n'
            f'  <img src="{img_path}" alt="{caption}">\n'
            f'  <figcaption>{caption}</figcaption>\n'
            f'</figure>\n'
        )
        found = False
        for i, m in enumerate(matches):
            if i in used_indices:
                continue
            inner_text = strip_tags(m.group(3))
            if keyword in inner_text:
                inserts_with_pos.append((m.end(), figure_html))
                used_indices.add(i)
                print(f"  [OK] inserted image after heading: {inner_text[:50]!r}")
                found = True
                break
        if not found:
            print(f"  [WARN] heading not found for keyword: {keyword!r}")

    # 後ろから挿入してオフセット維持
    inserts_with_pos.sort(key=lambda x: x[0], reverse=True)
    for pos, fig_html in inserts_with_pos:
        html = html[:pos] + fig_html + html[pos:]
    return html


NAV_HTML = """
<nav class="doc-nav">
  <a href="要件定義書.html"{requirements_class}>要件定義書</a>
  <a href="詳細設計書.html"{design_class}>詳細設計書</a>
</nav>
"""


def build_nav(current: str) -> str:
    return NAV_HTML.format(
        requirements_class=' class="current"' if current == "requirements" else "",
        design_class=' class="current"' if current == "design" else "",
    )


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
<header class="doc-header">
  <h1>{title}</h1>
  <div class="subtitle">{subtitle}</div>
</header>
{nav}
<main class="doc-body">
{body}
</main>
<footer class="doc-footer">
  &copy; 2026 product-register project &mdash; Auto-generated from {src}
</footer>
</body>
</html>
"""


def convert_doc(spec: dict) -> None:
    src = ROOT / spec["src"]
    dst = ROOT / spec["dst"]
    print(f"\n=== {src.name} -> {dst.name} ===")

    md_text = src.read_text(encoding="utf-8")
    html_body = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code", "toc"],
        extension_configs={"toc": {"toc_depth": "2-3"}},
    )
    html_body = insert_images(html_body, spec["image_inserts"])

    out_html = HTML_TEMPLATE.format(
        title=spec["title"],
        subtitle=spec["subtitle"],
        nav=build_nav(spec["current_nav"]),
        body=html_body,
        src=spec["src"],
    )
    dst.write_text(out_html, encoding="utf-8")
    print(f"  Written: {dst.name} ({len(out_html)} bytes)")


def main() -> None:
    for spec in DOCS:
        convert_doc(spec)
    print("\nDone.")


if __name__ == "__main__":
    main()
