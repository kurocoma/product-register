import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput, upsertProduct } from "@/lib/product/repository";

export const runtime = "nodejs";

/** POST = 1商品の販売価格・表示価格をインライン編集で更新（自動保存用）。
 * body: { selling_price?: number, display_price?: number }
 * display_price は 0 で「販売価格に連動」。一覧で販売価格を編集すると同額が渡る（連動）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: { selling_price?: unknown; display_price?: unknown } = {};
  try { body = await req.json(); } catch { /* 空 */ }

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const p = dbRowToProductInput(row);

  if (typeof body.selling_price === "number" && Number.isFinite(body.selling_price)) {
    p.selling_price = Math.max(0, Math.round(body.selling_price));
  }
  if (typeof body.display_price === "number" && Number.isFinite(body.display_price)) {
    p.display_price = Math.max(0, Math.round(body.display_price));
  }

  try {
    await upsertProduct(supabase, p, id);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, selling_price: p.selling_price, display_price: p.display_price });
}
