/** 商品の検索・絞り込みの共有純ロジック。
 * 商品一覧（ProductList）と CSV ダウンロード画面（CsvBulkDownloadForm）が
 * 同じ規則で検索できるようにするための共有層（ユニットテスト対象）。 */

export type ProductSearchFields = {
  ne_code: string;
  product_name: string;
  jan_code?: string;
  /** SKU の ne_code・SKU管理番号・楽天管理番号など、代表コード以外の検索対象コード。
   * 多SKU統合商品を SKU 側のコード（例 r74-1）で見つけられるようにする。 */
  sub_codes?: string[];
};

/** NEコード・商品名・JANコード・sub_codes の部分一致（大文字小文字無視）。query 空（空白のみ含む）は常に true。 */
export function matchesProductQuery(p: ProductSearchFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.ne_code, p.product_name, p.jan_code ?? "", ...(p.sub_codes ?? [])].some((v) =>
    String(v).toLowerCase().includes(q),
  );
}

/** products.extra から検索用の sub_codes（SKU の ne_code / SKU管理番号 / 楽天管理番号）を集める。
 * 空文字は除外し、重複は1つにまとめる。extra の形が想定外でも落ちない（tolerant）。 */
export function productSubCodes(extra: Record<string, unknown> | null | undefined): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (s) out.add(s);
  };
  const variants = (extra as { variants?: unknown })?.variants;
  if (Array.isArray(variants)) {
    for (const v of variants) {
      const vv = v as { ne_code?: unknown; sku_manage_number?: unknown };
      add(vv?.ne_code);
      add(vv?.sku_manage_number);
    }
  }
  add((extra as { rakuten_manage_number?: unknown })?.rakuten_manage_number);
  return [...out];
}

/** 掲載状況の絞り込み値。"" = 全て / "listed" = 掲載中 / "unlisted" = 未掲載。 */
export type ListedFilter = "" | "listed" | "unlisted";

/** 掲載状況絞り込み。presence には mallPresence()（反映ボタン活性化と同じ情報源）の結果を渡す。
 * 楽天・Yahoo の条件は AND（両方指定したときは両方満たす商品のみ）。 */
export function matchesListedFilter(
  presence: { rakuten: boolean; yahoo: boolean },
  filter: { rakuten: ListedFilter; yahoo: ListedFilter },
): boolean {
  const one = (on: boolean, f: ListedFilter) => f === "" || (f === "listed" ? on : !on);
  return one(presence.rakuten, filter.rakuten) && one(presence.yahoo, filter.yahoo);
}
