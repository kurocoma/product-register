import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTokens, resolveTokens, assembleRelated } from "@/lib/ne-master/related";
import type { ItemLite, CompRow, MallRow } from "@/lib/ne-master/related";

export const runtime = "nodejs";

const CHUNK = 300;
function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

/** POST = 単品コード/JAN(複数貼り付け)を受け、含むセット＋全構成品＋モールコードを返す。 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let input = "";
  try {
    const b = (await req.json()) as { input?: unknown };
    input = typeof b?.input === "string" ? b.input : "";
  } catch {
    /* 空ボディ */
  }
  const tokens = parseTokens(input);
  if (tokens.length === 0) return NextResponse.json({ ok: false, error: "単品コード/JANを入力してください" }, { status: 400 });

  try {
    // 1) item_master(ne_code, jan) を全件ロード → トークン解決
    const items: ItemLite[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("ne_item_master").select("ne_code, jan_code").eq("user_id", user.id).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) items.push({ ne_code: r.ne_code as string, jan_code: (r.jan_code as string) ?? "" });
      if (rows.length < PAGE) break;
    }
    const { resolved, notFound } = resolveTokens(tokens, items);
    const singles = [...new Set([...resolved.values()].flat())];
    if (singles.length === 0) return NextResponse.json({ ok: true, sets: [], notFound, singleCount: 0, setCount: 0 });

    // 2) 含むセット
    const singleToSets: { single: string; set_ne_code: string }[] = [];
    for (const part of chunk(singles, CHUNK)) {
      const { data, error } = await supabase.from("ne_set_composition").select("set_ne_code, component_ne_code").eq("user_id", user.id).in("component_ne_code", part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) singleToSets.push({ single: r.component_ne_code as string, set_ne_code: r.set_ne_code as string });
    }
    const setCodes = [...new Set(singleToSets.map((s) => s.set_ne_code))];

    // 3) それらセットの全構成 + モールコード
    const comps: CompRow[] = [];
    for (const part of chunk(setCodes, CHUNK)) {
      const { data, error } = await supabase.from("ne_set_composition").select("set_ne_code, component_ne_code, suryo, set_name, set_price").eq("user_id", user.id).in("set_ne_code", part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) comps.push(r as CompRow);
    }
    const malls: MallRow[] = [];
    for (const part of chunk(setCodes, CHUNK)) {
      const { data, error } = await supabase.from("ne_mall_code").select("ne_code, mall, manage_no").eq("user_id", user.id).in("ne_code", part);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) malls.push(r as MallRow);
    }

    const sets = assembleRelated(singleToSets, comps, malls);
    return NextResponse.json({ ok: true, sets, notFound, singleCount: singles.length, setCount: sets.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "検索に失敗しました: " + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
