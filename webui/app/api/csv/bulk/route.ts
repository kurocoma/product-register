import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { dbRowToProductInput, listProducts } from "@/lib/product/repository";
import { recordHistory } from "@/lib/history/recorder";
import { RakutenConverter } from "@/lib/converters/rakuten";
import { NEConverter } from "@/lib/converters/ne";
import { YahooConverter } from "@/lib/converters/yahoo";
import { ShopifyConverter } from "@/lib/converters/shopify";
import { writeCsv } from "@/lib/csv/writer";

export async function POST(req: Request) {
  const body = (await req.json()) as { productIds?: string[]; malls?: string[] };
  const productIds = body.productIds ?? [];
  const malls = body.malls ?? [];

  if (malls.length === 0) {
    return new NextResponse("No mall selected", { status: 400 });
  }

  const supabase = await createClient();
  const all = await listProducts(supabase);
  const products =
    productIds.length > 0
      ? all.filter((r) => productIds.includes(r.id)).map((r) => dbRowToProductInput(r))
      : all.map((r) => dbRowToProductInput(r));

  const zip = new JSZip();

  if (malls.includes("rakuten")) {
    const c = new RakutenConverter();
    zip.file("rakuten_normal_item.csv", writeCsv(c.convert(products), c.encoding));
  }
  if (malls.includes("yahoo")) {
    const c = new YahooConverter();
    zip.file("yahoo.csv", writeCsv(c.convert(products), c.encoding));
  }
  if (malls.includes("ne_single") || malls.includes("ne_set")) {
    const c = new NEConverter();
    const { singles, sets } = c.convert(products);
    if (malls.includes("ne_single")) zip.file("ne_single.csv", writeCsv(singles, c.encoding));
    if (malls.includes("ne_set")) zip.file("ne_set.csv", writeCsv(sets, c.encoding));
  }
  if (malls.includes("shopify")) {
    const c = new ShopifyConverter();
    zip.file("shopify.csv", writeCsv(c.convert(products), c.encoding));
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  await recordHistory(supabase, "csv_export", null, {
    malls,
    productCount: products.length,
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="csv-export-${date}.zip"`,
    },
  });
}
