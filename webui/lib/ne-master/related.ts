/** 関連商品抽出(Phase 2)の純粋ロジック。DBアクセスは route が行い、ここは解決と組立のみ。 */

export type ItemLite = { ne_code: string; jan_code: string };
export type CompRow = { set_ne_code: string; component_ne_code: string; suryo: number; set_name: string; set_price: number | null };
export type MallRow = { ne_code: string; mall: string; manage_no: string };

/** 貼り付けテキストをトークン配列へ（改行/カンマ/空白区切り・trim・重複排除）。 */
export function parseTokens(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((t) => t.trim()).filter((t) => t !== ""))];
}

/** トークン → ne_code 群（商品コード一致、または JAN 一致＝1対多あり）。未解決は notFound。 */
export function resolveTokens(
  tokens: string[],
  items: ItemLite[],
): { resolved: Map<string, string[]>; notFound: string[] } {
  const codeSet = new Set(items.map((i) => i.ne_code));
  const byJan = new Map<string, string[]>();
  for (const i of items) {
    if (i.jan_code) {
      const a = byJan.get(i.jan_code) ?? [];
      a.push(i.ne_code);
      byJan.set(i.jan_code, a);
    }
  }
  const resolved = new Map<string, string[]>();
  const notFound: string[] = [];
  for (const t of tokens) {
    if (codeSet.has(t)) resolved.set(t, [t]);
    else if (byJan.has(t)) resolved.set(t, byJan.get(t)!);
    else notFound.push(t);
  }
  return { resolved, notFound };
}

export type RelatedSet = {
  set_ne_code: string;
  set_name: string;
  set_price: number | null;
  components: { ne_code: string; suryo: number }[];
  mall_codes: Record<string, string>; // mall → manage_no
  matched_singles: string[];
  missing_link: boolean; // モール別コードが1つも無い（紐づくはずが無い＝紐づけ漏れの手掛かり）
};

/** 含むセット×構成×モールコードから、セット単位の関連結果を組み立てる。 */
export function assembleRelated(
  singleToSets: { single: string; set_ne_code: string }[],
  comps: CompRow[],
  malls: MallRow[],
): RelatedSet[] {
  const compBySet = new Map<string, CompRow[]>();
  for (const c of comps) {
    const a = compBySet.get(c.set_ne_code) ?? [];
    a.push(c);
    compBySet.set(c.set_ne_code, a);
  }
  const singlesBySet = new Map<string, Set<string>>();
  for (const s of singleToSets) {
    const set = singlesBySet.get(s.set_ne_code) ?? new Set<string>();
    set.add(s.single);
    singlesBySet.set(s.set_ne_code, set);
  }
  const mallBySet = new Map<string, Record<string, string>>();
  for (const m of malls) {
    const r = mallBySet.get(m.ne_code) ?? {};
    r[m.mall] = m.manage_no;
    mallBySet.set(m.ne_code, r);
  }

  const out: RelatedSet[] = [];
  for (const setCode of [...singlesBySet.keys()].sort()) {
    const cs = compBySet.get(setCode) ?? [];
    const first = cs[0];
    const mall_codes = mallBySet.get(setCode) ?? {};
    out.push({
      set_ne_code: setCode,
      set_name: first?.set_name ?? "",
      set_price: first?.set_price ?? null,
      components: cs
        .map((c) => ({ ne_code: c.component_ne_code, suryo: c.suryo }))
        .sort((a, b) => a.ne_code.localeCompare(b.ne_code)),
      mall_codes,
      matched_singles: [...singlesBySet.get(setCode)!].sort(),
      missing_link: Object.keys(mall_codes).length === 0,
    });
  }
  return out;
}

const MALLS = ["rakuten", "yahoo", "amazon", "shimanoya"] as const;

/** 関連結果をCSV（ダウンロード用）にする。1行=1セット。 */
export function relatedToCsv(sets: RelatedSet[]): string {
  const header = ["元単品", "セット商品コード", "セット商品名", "セット販売価格", "構成品", "構成品数", "楽天コード", "Yahooコード", "Amazonコード", "しまのやコード", "紐づけ漏れ"];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [header.join(",")];
  for (const s of sets) {
    const comps = s.components.map((c) => `${c.ne_code}×${c.suryo}`).join("; ");
    const row = [
      s.matched_singles.join("; "),
      s.set_ne_code,
      s.set_name,
      s.set_price == null ? "" : String(s.set_price),
      comps,
      String(s.components.length),
      ...MALLS.map((m) => s.mall_codes[m] ?? ""),
      s.missing_link ? "○" : "",
    ];
    lines.push(row.map((c) => esc(String(c))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
