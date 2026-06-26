import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { productVariants } from "@/lib/product/schema";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { buildRakutenManageNumber, buildRakutenUpsertBody, validateUpsertBody } from "@/lib/converters/rakuten-api";
import { upsertItem, getItem } from "@/lib/rakuten/item-client";
import { bulkUpsertInventory } from "@/lib/rakuten/inventory-client";

export const runtime = "nodejs";

/** GET = dry-run プレビュー（書き込みなし）。送信予定の upsert body と既存有無を返す。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const manageNumber = buildRakutenManageNumber(product);
  const body = buildRakutenUpsertBody(product);
  const valid = validateUpsertBody(manageNumber, body);

  let exists = false;
  try {
    exists = (await getItem(cred, manageNumber)).exists;
  } catch { /* プレビューは続行 */ }

  return NextResponse.json({
    ok: true,
    dryRun: true,
    mall: "rakuten",
    manageNumber,
    exists,
    willOverwrite: exists,
    valid: valid.ok,
    missing: valid.ok ? [] : valid.missing,
    body,
  });
}

/** POST = commit（items.upsert 実行）。body: { hideItem?: boolean }
 * ⚠ upsert は全置換。多SKU商品の一部だけ送ると他SKUが消える。MVPは単一SKU前提。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });

  // 安全登録が既定: 倉庫(hideItem)・サーチ在庫非表示(hideStock)・在庫0。
  // body.publish=true で公開状態にできる（その場合 hideItem/hideStock/在庫0 を解除）。
  const reqBody = await req.json().catch(() => ({}));
  const publish: boolean = reqBody?.publish === true;
  const hideItem = !publish;
  const hideStock = !publish;

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const manageNumber = buildRakutenManageNumber(product);
  const body = buildRakutenUpsertBody(product, { hideItem, hideStock });
  const valid = validateUpsertBody(manageNumber, body);
  if (!valid.ok) return NextResponse.json({ ok: false, error: "必須項目が不足: " + valid.missing.join(", ") }, { status: 400 });

  const result = await upsertItem(cred, manageNumber, body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "items.upsert 失敗: " + result.message, status: result.status, detail: result.body }, { status: 502 });
  }

  // 在庫数を設定（安全登録は 0）。商品登録成功後に InventoryAPI で別送。
  // 多SKU: 全SKU分を upsert の variant キー(sku_manage_number||ne_code)で送る（在庫variantIdとupsert keyを一致させる）。
  const quantity = publish ? 0 : 0; // 当面は常に0（在庫連携は別トラック）
  const inv = await bulkUpsertInventory(
    cred,
    productVariants(product).map((v) => ({ manageNumber, variantId: v.sku_manage_number?.trim() || v.ne_code, quantity })),
  );

  return NextResponse.json({
    ok: true, mall: "rakuten", manageNumber, created: result.created, status: result.status,
    safeState: !publish, inventorySet: inv.ok, inventoryMessage: inv.ok ? `在庫${quantity}` : inv.message,
  });
}
