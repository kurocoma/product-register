import click
from pathlib import Path
from datetime import datetime

@click.group()
def main():
    """商品登録CSV変換ツール"""
    pass

@main.command()
@click.argument("input_file", type=click.Path(exists=True, path_type=Path))
@click.option("--mall", type=click.Choice(["rakuten", "ne", "yahoo", "shopify", "all"]),
              default="all", help="出力対象モール")
@click.option("--output", "-o", type=click.Path(path_type=Path), default=Path("./output"),
              help="出力ディレクトリ")
def convert(input_file: Path, mall: str, output: Path):
    """統一入力CSVから各モール用CSVを生成する"""
    from product_register.reader import read_input_csv
    from product_register.converters.rakuten import RakutenConverter
    from product_register.converters.ne import NEConverter
    from product_register.converters.yahoo import YahooConverter
    from product_register.converters.shopify import ShopifyConverter
    from product_register.writers.csv_writer import write_csv

    output.mkdir(parents=True, exist_ok=True)
    products = read_input_csv(input_file)
    click.echo(f"読み込み: {len(products)} 商品")

    targets = ["rakuten", "ne", "yahoo", "shopify"] if mall == "all" else [mall]

    if "rakuten" in targets:
        conv = RakutenConverter()
        rows = conv.convert(products)
        write_csv(rows, output / "rakuten_normal_item.csv", encoding=conv.encoding)
        click.echo(f"  楽天: {len(rows)} 行 → {output / 'rakuten_normal_item.csv'} ({conv.encoding})")

    if "ne" in targets:
        conv = NEConverter()
        singles, sets = conv.convert(products)
        write_csv(singles, output / "ne_single.csv", encoding=conv.encoding)
        write_csv(sets, output / "ne_set.csv", encoding=conv.encoding)
        click.echo(f"  NE単品: {len(singles)} 行, NE セット: {len(sets)} 行 ({conv.encoding})")

    if "yahoo" in targets:
        conv = YahooConverter()
        rows = conv.convert(products)
        write_csv(rows, output / "yahoo.csv", encoding=conv.encoding)
        click.echo(f"  Yahoo: {len(rows)} 行 → {output / 'yahoo.csv'} ({conv.encoding})")

    if "shopify" in targets:
        conv = ShopifyConverter()
        rows = conv.convert(products)
        write_csv(rows, output / "shopify.csv", encoding=conv.encoding)
        click.echo(f"  Shopify: {len(rows)} 行 → {output / 'shopify.csv'} ({conv.encoding})")

    click.echo("完了!")

@main.command()
@click.argument("actual_dir", type=click.Path(exists=True, path_type=Path))
@click.argument("expected_dir", type=click.Path(exists=True, path_type=Path))
@click.option("--log", "-l", type=click.Path(path_type=Path), default=Path("./logs"),
              help="ログ出力ディレクトリ")
def verify(actual_dir: Path, expected_dir: Path, log: Path):
    """出力CSVと期待値CSVの差分を検証し、構造化ログを出力する。"""
    from product_register.verify.diff_checker import compare_csv
    from product_register.verify.reporter import generate_report, print_summary

    log.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    file_map = {
        "rakuten": ("rakuten_normal_item.csv", "商品管理番号（商品URL）", "cp932"),
        "ne_single": ("ne_single.csv", "syohin_code", "utf-8"),
        "ne_set": ("ne_set.csv", "syohin_code", "utf-8"),
        "yahoo": ("yahoo.csv", "code", "utf-8-sig"),
        "shopify": ("shopify.csv", ["Handle", "Image Position"], "utf-8-sig"),
    }

    all_ok = True
    for mall_key, (filename, key_col, encoding) in file_map.items():
        actual_file = actual_dir / filename
        expected_file = expected_dir / filename
        if not actual_file.exists() or not expected_file.exists():
            click.echo(f"  [{mall_key}] スキップ（ファイルなし）")
            continue

        mall_name = mall_key.split("_")[0]
        result = compare_csv(actual_file, expected_file, key_column=key_col, mall=mall_name, encoding=encoding)
        log_path = log / f"verify_{mall_key}_{ts}.json"
        generate_report(result, log_path)
        click.echo(print_summary(result))
        click.echo(f"  ログ: {log_path}")

        if result["summary"]["mismatched_rows"] > 0:
            all_ok = False

    if all_ok:
        click.echo("\n全モール一致!")
    else:
        click.echo("\n差分あり。logs/ のJSONを確認してください。")
