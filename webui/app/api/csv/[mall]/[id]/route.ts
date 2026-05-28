import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  dbRowToProductInput,
  getProduct,
  listProducts,
} from "@/lib/product/repository";
import { RakutenConverter } from "@/lib/converters/rakuten";
import { NEConverter } from "@/lib/converters/ne";
import { YahooConverter } from "@/lib/converters/yahoo";
import { ShopifyConverter } from "@/lib/converters/shopify";
import { writeCsv } from "@/lib/csv/writer";
import type { ProductInput } from "@/lib/product/schema";

const FILENAMES: Record<string, string> = {
  rakuten: "rakuten_normal_item.csv",
  ne_single: "ne_single.csv",
  ne_set: "ne_set.csv",
  yahoo: "yahoo.csv",
  shopify: "shopify.csv",
};

function baseCodeOf(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

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

  // peers: 同じ base_code を持つ商品も含めて変換 (grouping/親子構造のため)
  const allRows = await listProducts(supabase);
  const peers = allRows
    .map((r) => dbRowToProductInput(r))
    .filter((p) => baseCodeOf(p) === baseCodeOf(target));

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
      const c = new YahooConverter();
      csvRows = c.convert(peers);
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
