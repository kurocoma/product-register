import { describe, it, expect } from "vitest";
import { applyYahooMappingsToRows, collectMallCategoryIds } from "./category-assist";
import { emptyGridRow, type GridRow } from "./grid-rows";
import type { YahooCategoryMapping } from "./category-mapping";

/** カテゴリ列グループ見出しの「YahooカテゴリIDをコピー」ボタンの純関数層のテスト。
 * 規則:
 * - 全行のモール基本カテゴリIDのユニーク集合（collectMallCategoryIds）を解決してから、
 *   各行へは「空欄のときだけ」適用する（手入力優先 = applyYahooCandidate と同一規則）
 * - 適用行数（applied）/ 入力済みスキップ行数（skipped）/ 候補なし行数（unresolved）を返し、
 *   「n行に適用（m行は入力済みのためスキップ）」の表示に使う */

function filledRow(overrides: Partial<GridRow> = {}): GridRow {
  return {
    ...emptyGridRow(),
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    product_name: "沖縄バヤリース 島レモネード PET 500ml",
    selling_price: "200",
    mall_category_id: "110692",
    auto: { ne_code: false, display_name: false },
    ...overrides,
  };
}

const MAPPING: YahooCategoryMapping = {
  yahoo_category_id: "13457",
  yahoo_category_name: "ソフトドリンク、ジュース",
  yahoo_path: "食品、飲料、製菓＞ソフトドリンク、ジュース",
  confidence: "high",
};

describe("collectMallCategoryIds（fetch すべきカテゴリIDのユニーク集合）", () => {
  it("trim して空欄を除き、出現順の重複なしで返す", () => {
    const rows = [
      filledRow({ mall_category_id: "110692" }),
      filledRow({ mall_category_id: " 110692 " }),
      filledRow({ mall_category_id: "999999" }),
      filledRow({ mall_category_id: "" }),
      emptyGridRow(),
    ];
    expect(collectMallCategoryIds(rows)).toEqual(["110692", "999999"]);
  });

  it("全行空なら空配列", () => {
    expect(collectMallCategoryIds([emptyGridRow(), emptyGridRow()])).toEqual([]);
  });
});

describe("applyYahooMappingsToRows（空欄の行のみ適用 = 手入力優先）", () => {
  it("空欄の行に ID/パスを適用し、入力済みの行はスキップとして数える", () => {
    const rows = [
      filledRow(), // 空欄 → 適用
      filledRow({ yahoo_category_id: "99999", yahoo_path: "手入力＞パス" }), // 入力済み → スキップ
      filledRow({ mall_category_id: "" }), // カテゴリID未入力 → 対象外（数えない）
    ];
    const mappings = new Map([["110692", MAPPING]]);
    const result = applyYahooMappingsToRows(rows, mappings);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.unresolved).toBe(0);
    expect(result.rows[0].yahoo_category_id).toBe("13457");
    expect(result.rows[0].yahoo_path).toBe(MAPPING.yahoo_path);
    expect(result.rows[1].yahoo_category_id).toBe("99999"); // 手入力優先
    expect(result.rows[1]).toBe(rows[1]); // 変更しない行は同一参照（UI の差分検知に使う）
    expect(result.rows[2]).toBe(rows[2]);
  });

  it("片方だけ空欄の行は空欄側だけ埋め、適用行として数える", () => {
    const rows = [filledRow({ yahoo_category_id: "99999" })]; // パスだけ空欄
    const result = applyYahooMappingsToRows(rows, new Map([["110692", MAPPING]]));
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rows[0].yahoo_category_id).toBe("99999");
    expect(result.rows[0].yahoo_path).toBe(MAPPING.yahoo_path);
  });

  it("マッピングが見つからないカテゴリIDの行は unresolved に数え、行は変えない", () => {
    const rows = [filledRow({ mall_category_id: "999999" }), filledRow()];
    const mappings = new Map<string, YahooCategoryMapping | null>([
      ["999999", null], // マスタに Yahoo 紐付けなし
      ["110692", MAPPING],
    ]);
    const result = applyYahooMappingsToRows(rows, mappings);
    expect(result.applied).toBe(1);
    expect(result.unresolved).toBe(1);
    expect(result.rows[0]).toBe(rows[0]);
    expect(result.rows[1].yahoo_category_id).toBe("13457");
  });

  it("カテゴリIDは trim 比較で解決する", () => {
    const rows = [filledRow({ mall_category_id: " 110692 " })];
    const result = applyYahooMappingsToRows(rows, new Map([["110692", MAPPING]]));
    expect(result.applied).toBe(1);
    expect(result.rows[0].yahoo_category_id).toBe("13457");
  });

  it("適用が1行も無いときは元の配列をそのまま返す（no-op 判定可能）", () => {
    const rows = [filledRow({ yahoo_category_id: "99999", yahoo_path: "手入力＞パス" })];
    const result = applyYahooMappingsToRows(rows, new Map([["110692", MAPPING]]));
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.rows).toBe(rows);
  });

  it("元の行オブジェクトは変更しない（イミュータブル）", () => {
    const rows = [filledRow()];
    applyYahooMappingsToRows(rows, new Map([["110692", MAPPING]]));
    expect(rows[0].yahoo_category_id).toBe("");
    expect(rows[0].yahoo_path).toBe("");
  });
});
