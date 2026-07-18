import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  dbRowToProductInput,
  getProduct,
  listProducts,
} from "@/lib/product";
import { yahooItemsForProduct } from "@/lib/product";
import { RakutenConverter, manageNumberOf } from "@/lib/converters";
import { NEConverter } from "@/lib/converters";
import { YahooConverter } from "@/lib/converters";
import { ShopifyConverter } from "@/lib/converters";
import { writeCsv } from "@/lib/csv";

const FILENAMES: Record<string, string> = {
  rakuten: "rakuten_normal_item.csv",
  ne_single: "ne_single.csv",
  ne_set: "ne_set.csv",
  yahoo: "yahoo.csv",
  shopify: "shopify.csv",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ mall: string; id: string }> },
) {
  const { mall, id } = await params;
  if (!(mall in FILENAMES)) {
    return new NextResponse("Unknown mall", { status: 400 });
  }

  const supabase = await createClient();
  const targetRow = await getProduct(supabase, id);
  if (!targetRow) return new NextResponse("Not found", { status: 404 });
  const target = dbRowToProductInput(targetRow);

  // peers: 同じページ(グループキー)を持つ商品も含めて変換 (grouping/親子構造のため)。
  // キーは converter と同じ「実管理番号(rakuten_manage_number)優先、無ければ base_code」。
  // 取込商品は maker/JAN が空で base_code が "-0000" に衝突するため、base_code 比較だと
  // 無関係な取込商品が単品CSVに混入してしまう。
  const allRows = await listProducts(supabase);
  const peers = allRows
    .map((r) => dbRowToProductInput(r))
    .filter((p) => manageNumberOf(p) === manageNumberOf(target));

  let csvRows: Record<string, string>[];
  let encoding: "cp932" | "utf-8" | "utf-8-sig";
  let filename: string;

  switch (mall) {
    case "rakuten": {
      const c = new RakutenConverter();
      csvRows = c.convert(peers);
      encoding = c.encoding;
      filename = FILENAMES.rakuten;
      break;
    }
    case "yahoo": {
      // Yahoo は統合商品（多SKU）でも SKU ごとに別商品として行を出力する
      // （ユーザー要件「Yahooは分ける」。item_code = 各SKUのNEコード）
      const c = new YahooConverter();
      csvRows = c.convert(peers.flatMap(yahooItemsForProduct));
      encoding = c.encoding;
      filename = FILENAMES.yahoo;
      break;
    }
    case "shopify": {
      const c = new ShopifyConverter();
      csvRows = c.convert(peers);
      encoding = c.encoding;
      filename = FILENAMES.shopify;
      break;
    }
    case "ne_single":
    case "ne_set": {
      const c = new NEConverter();
      const { singles, sets } = c.convert(peers);
      csvRows = mall === "ne_single" ? singles : sets;
      encoding = c.encoding;
      filename = FILENAMES[mall];
      break;
    }
    default:
      return new NextResponse("Unknown mall", { status: 400 });
  }

  const buf = writeCsv(csvRows, encoding);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
