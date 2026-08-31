/** 商品の検索・絞り込みの共有純ロジック。
 * 商品一覧（ProductList）と CSV ダウンロード画面（CsvBulkDownloadForm）が
 * 同じ規則で検索できるようにするための共有層（ユニットテスト対象）。 */

export type ProductSearchFields = {
  ne_code: string;
  product_name: string;
  /** 掲載商品名（モール表示名）。商品名と表記が違う商品を表示名でも見つけられるようにする。 */
  display_name?: string;
  jan_code?: string;
  /** SKU の ne_code・SKU管理番号・楽天管理番号など、代表コード以外の検索対象コード。
   * 多SKU統合商品を SKU 側のコード（例 r74-1）で見つけられるようにする。 */
  sub_codes?: string[];
};

/** 小書き文字 → 大書き文字（表記ゆれ吸収: ウェット/ウエット 等）。 */
const SMALL_KANA: Record<string, string> = {
  ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お", っ: "つ", ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ",
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ",
  ヵ: "カ", ヶ: "ケ",
};

/** 検索照合用の正規化。小文字化・空白（全角含む）除去・長音「ー」除去・小書き文字の大書き化。
 * クエリと索引（haystack）の両方に同じ正規化を通すことで、表記ゆれを部分一致で吸収する。 */
export function normalizeSearchText(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/ー/g, "")
    .replace(/[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/g, (c) => SMALL_KANA[c] ?? c);
}

/** 検索用の前計算索引（haystack）。全フィールドを正規化して空白区切りで1本にまとめる。
 * 正規化後のクエリには空白が残らないため、フィールドをまたいだ偶然の一致は起きない。
 * 商品一覧は「1キーストロークごとに全商品を正規化し直す」と固まる（260812/260901 実測）ため、
 * 商品配列が変わったときだけこれを作り直し、打鍵時は matchesSearchHaystack だけを回す。 */
export function buildSearchHaystack(p: ProductSearchFields): string {
  return [p.ne_code, p.product_name, p.display_name ?? "", p.jan_code ?? "", ...(p.sub_codes ?? [])]
    .map((v) => normalizeSearchText(String(v ?? "")))
    .filter(Boolean)
    .join(" ");
}

/** 前計算済み haystack との照合。normalizedQuery は normalizeSearchText 済みを渡す（呼び出し側の責務）。
 * 空クエリは常に true（絞り込みなし）。 */
export function matchesSearchHaystack(haystack: string, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return haystack.includes(normalizedQuery);
}

/** NEコード・商品名・掲載商品名・JANコード・sub_codes の部分一致（正規化＝大文字小文字・空白・
 * 長音・小書き文字の表記ゆれを無視）。query 空（空白のみ含む）は常に true。
 * 実装は索引経由（buildSearchHaystack + matchesSearchHaystack）と同一関数を使い、
 * 一覧（索引経由）と CSV 画面（この関数）で絞り込み結果が食い違わないようにする。 */
export function matchesProductQuery(p: ProductSearchFields, query: string): boolean {
  return matchesSearchHaystack(buildSearchHaystack(p), normalizeSearchText(query));
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
