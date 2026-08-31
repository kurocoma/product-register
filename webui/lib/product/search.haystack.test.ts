/** 検索用の前計算索引（buildSearchHaystack / matchesSearchHaystack）の回帰テスト。
 *
 *  商品一覧は「1キーストロークごとに全商品を正規化し直す」のをやめ、商品配列が変わったときだけ
 *  索引を作り直す形にした（260812 パフォーマンス修正）。索引経由の判定が従来の
 *  matchesProductQuery と**完全に同じ結果**であることを固定する（絞り込み結果を変えないため）。 */
import { describe, expect, it } from "vitest";
import {
  buildSearchHaystack,
  matchesProductQuery,
  matchesSearchHaystack,
  normalizeSearchText,
  type ProductSearchFields,
} from "./search";

const viaIndex = (p: ProductSearchFields, query: string) =>
  matchesSearchHaystack(buildSearchHaystack(p), normalizeSearchText(query));

const products: ProductSearchFields[] = [
  { ne_code: "a001-1234", product_name: "沖縄そば 5食セット", jan_code: "4900000001111" },
  { ne_code: "n050-1", product_name: "ウェットブラシ オリジナル ディタングラー", display_name: "【送料無料】ウエットブラシ 正規品" },
  { ne_code: "r74", product_name: "セット商品", sub_codes: ["r74-1", "r74-2", "shimanoya-01"] },
  { ne_code: "c003", product_name: "テスト商品" },
  { ne_code: "", product_name: "", display_name: "", jan_code: "", sub_codes: [] },
];

const queries = [
  "", "   ", "a001", "A001-12", "沖縄そば", "4900000001111",
  "ウェットブラシ", "ウエットブラシ", "ウェット ブラシ", "送料無料", "正規品",
  "r74-2", "shimanoya", "テスト", "存在しないキーワード", "9999999999999", "ー",
];

describe("索引経由の判定は matchesProductQuery と一致する", () => {
  it("全商品 × 全クエリで結果が完全一致する", () => {
    for (const p of products) {
      for (const q of queries) {
        expect(`${p.ne_code}|${q}|${viaIndex(p, q)}`).toBe(`${p.ne_code}|${q}|${matchesProductQuery(p, q)}`);
      }
    }
  });
});

describe("buildSearchHaystack", () => {
  it("全フィールドを正規化して1本にまとめる（空白・長音・小書き文字は吸収済み）", () => {
    const h = buildSearchHaystack({ ne_code: "N050-1", product_name: "ウェット ブラシー", display_name: "", jan_code: "490", sub_codes: ["r74-1"] });
    expect(h).toContain("n050-1");
    expect(h).toContain("ウエツトブラシ"); // 空白・長音を除去、小書き文字を大書きへ
    expect(h).toContain("490");
    expect(h).toContain("r74-1");
  });

  it("フィールドをまたいだ偶然の一致は起こさない（区切りは空白＝正規化後のクエリには現れない）", () => {
    const p: ProductSearchFields = { ne_code: "abc", product_name: "def" };
    expect(viaIndex(p, "abcdef")).toBe(false);
    expect(matchesProductQuery(p, "abcdef")).toBe(false);
    expect(viaIndex(p, "abc")).toBe(true);
    expect(viaIndex(p, "def")).toBe(true);
  });
});

describe("matchesSearchHaystack", () => {
  it("空クエリは常に true（絞り込みなし）", () => {
    expect(matchesSearchHaystack("", "")).toBe(true);
    expect(matchesSearchHaystack("なにか", "")).toBe(true);
  });

  it("クエリの正規化は呼び出し側の責務（正規化済みの文字列を渡す前提）", () => {
    const h = buildSearchHaystack({ ne_code: "A001", product_name: "沖縄そば" });
    expect(matchesSearchHaystack(h, normalizeSearchText("A001"))).toBe(true);
    expect(matchesSearchHaystack(h, "A001")).toBe(false); // 未正規化（大文字のまま）は当たらない
  });
});
