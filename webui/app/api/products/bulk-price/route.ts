import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput, upsertProduct } from "@/lib/product/repository";

export const runtime = "nodejs";

type Mode = "set" | "pct" | "yen";

/** 1価格に編集操作を適用（0未満は0に丸め、整数円）。 */
function applyMode(cur: number, mode: Mode, value: number): number {
  let next: number;
  if (mode === "set") next = value;
  else if (mode === "pct") next = cur * (1 + value / 100);
  else next = cur + value; // yen
  return Math.max(0, Math.round(next));
}

/** POST = チェックした商品の販売価格を一括編集する。
 * body: { ids: string[], mode: "set"|"pct"|"yen", value: number }
 * - 多SKU(variants[])は各SKUの販売価格にも同じ操作を適用する。
 * - 表示価格は selling_price から導出（CSV/Yahoo は 表示価格=販売価格）。Yahoo反映時は original_price も同値同期。 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let ids: string[] = [];
  let mode: Mode = "pct";
  let value = 0;
  try {
    const body = (await req.json()) as { ids?: unknown; mode?: unknown; value?: unknown };
    ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
    if (body.mode === "set" || body.mode === "pct" || body.mode === "yen") mode = body.mode;
    value = Number(body.value);
  } catch {
    /* 不正ボディ */
  }
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "対象が選択されていません" }, { status: 400 });
  if (!Number.isFinite(value)) return NextResponse.json({ ok: false, error: "変更値が不正です" }, { status: 400 });

  const results: { id: string; ok: boolean; sellingPrice?: number; error?: string }[] = [];
  for (const id of ids) {
    try {
      const row = await getProduct(supabase, id);
      if (!row) { results.push({ id, ok: false, error: "見つかりません" }); continue; }
      const p = dbRowToProductInput(row);
      p.selling_price = applyMode(p.selling_price, mode, value);
      if (p.variants && p.variants.length > 0) {
        p.variants = p.variants.map((v) => ({ ...v, selling_price: applyMode(v.selling_price, mode, value) }));
      }
      await upsertProduct(supabase, p, id);
      results.push({ id, ok: true, sellingPrice: p.selling_price });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}
