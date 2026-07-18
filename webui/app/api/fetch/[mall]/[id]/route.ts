import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput, upsertProduct } from "@/lib/product/repository";
import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem as getRakutenItem } from "@/lib/rakuten/item-client";
import { parseRakutenItem } from "@/lib/converters/rakuten-item-parser";
import { buildRakutenManageNumber } from "@/lib/converters/rakuten-api";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { getItem as getYahooItem } from "@/lib/yahoo/item-client";
import { parseYahooItem } from "@/lib/converters/yahoo-item-parser";
import { getShopifyConfig } from "@/lib/shopify/auth";
import { getProduct as getShopifyProduct } from "@/lib/shopify/product-client";
import { parseShopifyItem, type ShopifyMeta } from "@/lib/converters/shopify-item-parser";

export const runtime = "nodejs";

type Mall = "rakuten" | "yahoo" | "shopify";

/** モール現状を取得して ProductInput 部分へパースする（共通）。 */
async function fetchMallSnapshot(
  mall: Mall,
  product: ProductInput,
): Promise<
  | { ok: true; exists: boolean; parsed: Partial<ProductInput>; key: string; shopifyMeta?: ShopifyMeta }
  | { ok: false; error: string; status: number }
> {
  if (mall === "rakuten") {
    const cred = getRakutenCredentialsFromEnv();
    if (!cred) return { ok: false, error: "楽天 ESA 認証情報が未設定です", status: 500 };
    const manageNumber = buildRakutenManageNumber(product);
    const got = await getRakutenItem(cred, manageNumber);
    if (!got.exists || !got.json) return { ok: true, exists: false, parsed: {}, key: manageNumber };
    const parsed = parseRakutenItem(got.json);
    delete (parsed as { _variantId?: string })._variantId;
    return { ok: true, exists: true, parsed, key: manageNumber };
  }
  if (mall === "shopify") {
    const scfg = getShopifyConfig();
    if (!scfg) return { ok: false, error: "Shopify 認証情報が未設定です（SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET）", status: 500 };
    const gid = product.shopify_product_id?.trim();
    if (!gid) return { ok: false, error: "Shopify 商品IDが未設定です（「モール取込」で Shopify から取込むと自動設定されます）", status: 400 };
    const got = await getShopifyProduct(scfg, gid);
    if (!got.exists) return { ok: true, exists: false, parsed: {}, key: gid };
    // fetch(取込)はフラット項目のみマージする（楽天と同じ流儀）。variants[] まで上書きすると
    // 楽天管理の配送詳細・属性が Shopify 由来の空値で消えるため除外する。
    // _shopifyMeta（対応列が無い項目の構造化保持）は DB マージ対象から分離し、プレビュー参照用に返す。
    const parsed = parseShopifyItem(got.product, { taxRate: product.tax_rate });
    const { _shopifyMeta } = parsed;
    const flat = { ...parsed };
    delete flat.variants;
    delete flat._shopifyMeta;
    return { ok: true, exists: true, parsed: flat, key: gid, shopifyMeta: _shopifyMeta };
  }
  const cfg = getYahooConfig();
  if (!cfg) return { ok: false, error: "Yahoo 認証情報が未設定です", status: 500 };
  let token: string;
  try {
    token = await getYahooAccessToken(cfg);
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）", status: 502 };
  }
  const got = await getYahooItem(token, cfg.sellerId, product.ne_code);
  if (!got.exists) return { ok: true, exists: false, parsed: {}, key: product.ne_code };
  // 税率フォールバック: XML に TaxrateType が無い場合は商品側の税率で税抜へ変換する（送受対称）。
  return { ok: true, exists: true, parsed: parseYahooItem(got.raw, { fallbackTaxRate: product.tax_rate }), key: product.ne_code };
}

/** モール現状をアプリ商品へ適用する（識別子は上書きしない）。 */
function applySnapshot(product: ProductInput, parsed: Partial<ProductInput>): ProductInput {
  const merged: Record<string, unknown> = { ...product, ...parsed };
  // 識別子・派生プロパティは取込で上書きしない
  merged.ne_code = product.ne_code;
  delete merged.is_single;
  delete merged.is_set;
  return merged as ProductInput;
}

/** GET = 取込プレビュー（書き込みなし）。モール現状をパースして返す。 */
export async function GET(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (mall !== "rakuten" && mall !== "yahoo" && mall !== "shopify") return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const snap = await fetchMallSnapshot(mall, product);
  if (!snap.ok) return NextResponse.json({ ok: false, error: snap.error }, { status: snap.status });

  return NextResponse.json({
    ok: true, dryRun: true, mall, key: snap.key, exists: snap.exists, parsed: snap.parsed,
    // Shopify: アプリに対応列が無い項目（status/handle/productType/SEO/在庫等）の参照値（破棄しない）。
    ...(snap.shopifyMeta ? { shopifyMeta: snap.shopifyMeta } : {}),
  });
}

/** POST = 取込確定。モール現状をアプリ商品へマージして保存する。 */
export async function POST(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (mall !== "rakuten" && mall !== "yahoo" && mall !== "shopify") return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const snap = await fetchMallSnapshot(mall, product);
  if (!snap.ok) return NextResponse.json({ ok: false, error: snap.error }, { status: snap.status });
  if (!snap.exists) return NextResponse.json({ ok: false, error: "モールに該当商品が存在しません（先に登録が必要です）", key: snap.key }, { status: 404 });

  const merged = applySnapshot(product, snap.parsed);
  // 取込値を schema で再検証（不正な JAN/価格等で DB を汚染しない）。
  let validated: ProductInput;
  try {
    validated = ProductInputSchema.parse(merged);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "取込データの検証に失敗しました: " + (e instanceof Error ? e.message : String(e)) }, { status: 422 });
  }
  const saved = await upsertProduct(supabase, validated, id);

  return NextResponse.json({
    ok: true, mall, key: snap.key, imported: Object.keys(snap.parsed), productId: saved.id,
  });
}
