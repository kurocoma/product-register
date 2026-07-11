/** 商品の検索・絞り込みの共有純ロジック。
 * 商品一覧（ProductList）と CSV ダウンロード画面（CsvBulkDownloadForm）が
 * 同じ規則で検索できるようにするための共有層（ユニットテスト対象）。 */

export type ProductSearchFields = { ne_code: string; product_name: string; jan_code?: string };

/** NEコード・商品名・JANコードの部分一致（大文字小文字無視）。query 空（空白のみ含む）は常に true。 */
export function matchesProductQuery(p: ProductSearchFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.ne_code, p.product_name, p.jan_code ?? ""].some((v) =>
    String(v).toLowerCase().includes(q),
  );
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
