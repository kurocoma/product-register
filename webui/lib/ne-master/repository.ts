import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemPatch, SetComp, MallRec } from "./build";

const CHUNK = 500;
function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
async function getUserId(supabase: SupabaseClient): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

/** item_master のマージ対象列（patch に存在する列だけ更新する）。 */
const ITEM_COLS = [
  "name", "selling_price", "tax_rate", "jan_code", "cost_price", "category",
  "supplier", "is_set", "is_discontinued", "zaiko_renkei", "daihyo_code",
] as const;

/** ne_item_master を列マージ upsert（複数ソースが別々の列を埋める）。sources は和集合。 */
export async function mergeItemMaster(
  supabase: SupabaseClient,
  patches: ItemPatch[],
): Promise<{ inserted: number; updated: number }> {
  const userId = await getUserId(supabase);

  // バッチ内で ne_code ごとに畳み込む（同一バッチに同コードが複数あっても列マージ）。
  const map = new Map<string, { patch: Record<string, unknown>; sources: Set<string> }>();
  for (const p of patches) {
    if (!p.ne_code) continue;
    const cur = map.get(p.ne_code) ?? { patch: {}, sources: new Set<string>() };
    for (const k of ITEM_COLS) {
      const v = (p as Record<string, unknown>)[k];
      if (v !== undefined) cur.patch[k] = v;
    }
    if (p.source) cur.sources.add(p.source);
    map.set(p.ne_code, cur);
  }

  let inserted = 0;
  let updated = 0;
  for (const codes of chunk([...map.keys()], CHUNK)) {
    const { data: existing, error: selErr } = await supabase
      .from("ne_item_master").select("*").eq("user_id", userId).in("ne_code", codes);
    if (selErr) throw new Error(selErr.message);
    const exMap = new Map((existing ?? []).map((r) => [r.ne_code as string, r as Record<string, unknown>]));

    // upsert行は全行で同一の列集合にする（PostgRESTがバッチ内で列を統合し、欠落列にNULLを入れて
    // NOT NULL違反になるのを防ぐ）。文字列列は ''、数値列は null、bool列は false を既定にする。
    const STR_COLS = ["jan_code", "name", "category", "supplier", "zaiko_renkei", "daihyo_code"] as const;
    const NUM_COLS = ["selling_price", "tax_rate", "cost_price"] as const; // nullable
    const BOOL_COLS = ["is_set", "is_discontinued"] as const;
    const rows = codes.map((ne) => {
      const ex = exMap.get(ne);
      const { patch, sources } = map.get(ne)!;
      const exSources = Array.isArray(ex?.sources) ? (ex!.sources as string[]) : [];
      if (ex) updated++; else inserted++;
      const row: Record<string, unknown> = {
        user_id: userId,
        ne_code: ne,
        sources: [...new Set([...exSources, ...sources])],
        updated_at: new Date().toISOString(),
      };
      for (const k of STR_COLS) row[k] = patch[k] !== undefined ? patch[k] : (ex?.[k] ?? "");
      for (const k of NUM_COLS) row[k] = patch[k] !== undefined ? patch[k] : (ex?.[k] ?? null);
      for (const k of BOOL_COLS) row[k] = patch[k] !== undefined ? patch[k] : (ex?.[k] ?? false);
      return row;
    });
    const { error } = await supabase.from("ne_item_master").upsert(rows, { onConflict: "user_id,ne_code" });
    if (error) throw new Error(error.message);
  }
  return { inserted, updated };
}

/** ne_set_composition を set_ne_code 単位で洗替え（構成変更に追従）。 */
export async function replaceSetComposition(
  supabase: SupabaseClient,
  comps: SetComp[],
): Promise<{ inserted: number }> {
  const userId = await getUserId(supabase);
  const setCodes = [...new Set(comps.map((c) => c.set_ne_code))];
  for (const codes of chunk(setCodes, CHUNK)) {
    const { error } = await supabase.from("ne_set_composition").delete().eq("user_id", userId).in("set_ne_code", codes);
    if (error) throw new Error(error.message);
  }
  let inserted = 0;
  for (const part of chunk(comps, CHUNK)) {
    const rows = part.map((c) => ({
      user_id: userId, set_ne_code: c.set_ne_code, component_ne_code: c.component_ne_code,
      suryo: c.suryo, set_name: c.set_name, set_price: c.set_price, tax_rate: c.tax_rate,
    }));
    const { error } = await supabase.from("ne_set_composition").upsert(rows, { onConflict: "user_id,set_ne_code,component_ne_code" });
    if (error) throw new Error(error.message);
    inserted += rows.length;
  }
  return { inserted };
}

/** ne_mall_code を (ne_code, mall) で upsert。 */
export async function upsertMallCodes(
  supabase: SupabaseClient,
  records: MallRec[],
): Promise<{ count: number }> {
  const userId = await getUserId(supabase);
  let count = 0;
  for (const part of chunk(records, CHUNK)) {
    const rows = part.map((r) => ({ user_id: userId, ne_code: r.ne_code, mall: r.mall, manage_no: r.manage_no, jan_code: r.jan_code }));
    const { error } = await supabase.from("ne_mall_code").upsert(rows, { onConflict: "user_id,ne_code,mall" });
    if (error) throw new Error(error.message);
    count += rows.length;
  }
  return { count };
}

/** excel-mall の ne_code 解決素材（item_master から既知ne_code集合・jan→ne_code を取得）。 */
export async function loadNeResolver(
  supabase: SupabaseClient,
): Promise<{ knownNeCodes: Set<string>; janToNe: Map<string, string[]> }> {
  const userId = await getUserId(supabase);
  const knownNeCodes = new Set<string>();
  const janToNe = new Map<string, string[]>();
  // 全件をページングで取得（item_master は数千件規模）。
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("ne_item_master").select("ne_code, jan_code").eq("user_id", userId).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const ne = r.ne_code as string;
      knownNeCodes.add(ne);
      const jan = (r.jan_code as string) || "";
      if (jan) {
        const arr = janToNe.get(jan) ?? [];
        arr.push(ne);
        janToNe.set(jan, arr);
      }
    }
    if (rows.length < PAGE) break;
  }
  return { knownNeCodes, janToNe };
}
