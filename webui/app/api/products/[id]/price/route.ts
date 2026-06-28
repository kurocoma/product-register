import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput, upsertProduct } from "@/lib/product/repository";

export const runtime = "nodejs";

const clampInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;

/** POST = 1商品（または多SKUの1バリエーション）の販売価格・表示価格をインライン編集で更新（自動保存用）。
 * body: { selling_price?: number, display_price?: number, variantIndex?: number }
 * - variantIndex 指定時はその variants[i] を更新し、フラットは variants[0] に追従させる。
 * - 未指定なら商品フラットの販売価格/表示価格を更新。display_price は 0 で「販売価格に連動」。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: { selling_price?: unknown; display_price?: unknown; variantIndex?: unknown } = {};
  try { body = await req.json(); } catch { /* 空 */ }
  const sp = clampInt(body.selling_price);
  const dp = clampInt(body.display_price);

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const p = dbRowToProductInput(row);

  const vi = body.variantIndex;
  if (typeof vi === "number" && p.variants[vi]) {
    if (sp !== null) p.variants[vi].selling_price = sp;
    if (dp !== null) p.variants[vi].display_price = dp;
    // フラットは先頭SKUに追従（一覧/プレビューの代表価格を整合）
    p.selling_price = p.variants[0].selling_price;
    p.display_price = p.variants[0].display_price ?? 0;
  } else {
    if (sp !== null) p.selling_price = sp;
    if (dp !== null) p.display_price = dp;
  }

  try {
    await upsertProduct(supabase, p, id);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, selling_price: p.selling_price, display_price: p.display_price });
}
