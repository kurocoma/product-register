import { describe, it, expect } from "vitest";
import {
  applyYahooCandidate,
  applyYahooToSameCategory,
  copyAttributesToSameCategory,
  loadAttributesIntoRow,
  sameCategoryRowIndexes,
  setRowAttribute,
} from "./category-assist";
import {
  buildProductsFromRows,
  emptyGridRow,
  gridRowToProductInput,
  type GridRow,
  type GridRowAttribute,
} from "./grid-rows";
import type { GenreAttribute } from "./genre-attributes";
import type { YahooCategoryMapping } from "./category-mapping";

function filledRow(overrides: Partial<GridRow> = {}): GridRow {
  return {
    ...emptyGridRow(),
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    product_type: "単品",
    quantity: "1",
    product_name: "沖縄バヤリース 島レモネード PET 500ml",
    display_name: "沖縄バヤリース 島レモネード PET 500ml",
    tax_rate: "8",
    selling_price: "200",
    mall_category_id: "110692",
    auto: { ne_code: false, display_name: false },
    ...overrides,
  };
}

/** 楽天ジャンル推奨属性のマスタ相当（内容量=必須・推奨単位 ml、ブランド名=任意） */
const GENRE_ATTRS: GenreAttribute[] = [
  { item_name: "内容量", requirement: "必須", recommended_unit: "ml", unit_choices: "ml/L", has_unit: true, sort_order: 1 },
  { item_name: "ブランド名", requirement: "任意", recommended_unit: "", unit_choices: "", has_unit: false, sort_order: 2 },
];

const YAHOO: YahooCategoryMapping = {
  yahoo_category_id: "13457",
  yahoo_category_name: "ソフトドリンク、ジュース",
  yahoo_path: "食品、飲料、製菓＞ソフトドリンク、ジュース",
  confidence: "high",
};

describe("loadAttributesIntoRow（読み込み → 項目・単位を行へ展開）", () => {
  it("項目・推奨単位が並び、値だけ入力すれば良い状態（value 空）になる", () => {
    const row = loadAttributesIntoRow(filledRow(), GENRE_ATTRS);
    expect(row.attributes).toEqual([
      { item: "内容量", value: "", unit: "ml", requirement: "必須" },
      { item: "ブランド名", value: "", unit: "", requirement: "任意" },
    ]);
  });

  it("入力済みの値は item 単位で保持する（再読み込みで消えない = 手入力優先）", () => {
    const before = filledRow({
      attributes: [{ item: "内容量", value: "500", unit: "ml", requirement: "必須" }],
    });
    const row = loadAttributesIntoRow(before, GENRE_ATTRS);
    expect(row.attributes?.[0]).toEqual({ item: "内容量", value: "500", unit: "ml", requirement: "必須" });
    expect(row.attributes?.[1].item).toBe("ブランド名");
  });

  it("マスタ未登録（attrs 空）なら行を変えない", () => {
    const row = filledRow();
    expect(loadAttributesIntoRow(row, [])).toBe(row);
  });
});

describe("setRowAttribute（パネルの値・単位入力を行へ反映）", () => {
  const base = () => loadAttributesIntoRow(filledRow(), GENRE_ATTRS);

  it("値の入力が attributes に入る（他の項目は不変・イミュータブル）", () => {
    const before = base();
    const after = setRowAttribute(before, 0, { value: "500" });
    expect(after.attributes?.[0].value).toBe("500");
    expect(after.attributes?.[1]).toEqual(before.attributes?.[1]);
    expect(before.attributes?.[0].value).toBe(""); // 元は変更しない
  });

  it("単位も更新できる", () => {
    const after = setRowAttribute(base(), 0, { unit: "L" });
    expect(after.attributes?.[0].unit).toBe("L");
    expect(after.attributes?.[0].value).toBe("");
  });

  it("範囲外 index は無視する", () => {
    const before = base();
    expect(setRowAttribute(before, 9, { value: "x" })).toBe(before);
    expect(setRowAttribute(before, -1, { value: "x" })).toBe(before);
  });
});

describe("パネルで入力した属性値が保存データ（ProductInput.attributes）に入る", () => {
  it("gridRowToProductInput が行の attributes を引き継ぐ", () => {
    const row = setRowAttribute(loadAttributesIntoRow(filledRow(), GENRE_ATTRS), 0, { value: "500" });
    const p = gridRowToProductInput(row);
    expect(p.attributes).toEqual([
      { item: "内容量", value: "500", unit: "ml", requirement: "必須" },
      { item: "ブランド名", value: "", unit: "", requirement: "任意" },
    ]);
  });

  it("バリエーション統合でも代表商品と各SKU（variants[]）に属性が入る", () => {
    const attrs: GridRowAttribute[] = [{ item: "内容量", value: "500", unit: "ml", requirement: "必須" }];
    const rows = [
      filledRow({ variation_key: "レモネード500", attributes: attrs }),
      filledRow({
        ne_code: "a009-4916-6",
        quantity: "6",
        product_type: "セット商品",
        selling_price: "1080",
        variation_key: "レモネード500",
        attributes: attrs,
      }),
    ];
    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1);
    expect(built[0].input?.attributes).toEqual(attrs);
    expect(built[0].input?.variants.map((v) => v.attributes)).toEqual([attrs, attrs]);
  });
});

describe("applyYahooCandidate（候補の適用は空欄のときだけ = 手入力優先）", () => {
  it("YahooカテゴリID・パスが空欄なら両方入る", () => {
    const { row, appliedId, appliedPath } = applyYahooCandidate(filledRow(), YAHOO);
    expect(appliedId).toBe(true);
    expect(appliedPath).toBe(true);
    expect(row.yahoo_category_id).toBe("13457");
    expect(row.yahoo_path).toBe("食品、飲料、製菓＞ソフトドリンク、ジュース");
  });

  it("手入力済みの ID は上書きせず、空欄のパスだけ埋める", () => {
    const before = filledRow({ yahoo_category_id: "99999" });
    const { row, appliedId, appliedPath } = applyYahooCandidate(before, YAHOO);
    expect(appliedId).toBe(false);
    expect(appliedPath).toBe(true);
    expect(row.yahoo_category_id).toBe("99999");
    expect(row.yahoo_path).toBe(YAHOO.yahoo_path);
  });

  it("両方入力済みなら何も変えない（行は同一参照）", () => {
    const before = filledRow({ yahoo_category_id: "99999", yahoo_path: "手入力＞パス" });
    const result = applyYahooCandidate(before, YAHOO);
    expect(result.appliedId).toBe(false);
    expect(result.appliedPath).toBe(false);
    expect(result.row).toBe(before);
  });
});

describe("sameCategoryRowIndexes（同じカテゴリIDの行の特定）", () => {
  it("同じモール基本カテゴリID（trim 比較）の他の行を返す", () => {
    const rows = [
      filledRow(),
      filledRow({ mall_category_id: " 110692 " }),
      filledRow({ mall_category_id: "999999" }),
      emptyGridRow(),
    ];
    expect(sameCategoryRowIndexes(rows, 0)).toEqual([1]);
  });

  it("カテゴリID 未入力の行からは対象なし（空同士を同一視しない）", () => {
    const rows = [emptyGridRow(), emptyGridRow()];
    expect(sameCategoryRowIndexes(rows, 0)).toEqual([]);
  });
});

describe("copyAttributesToSameCategory（属性値を同カテゴリの行すべてへ）", () => {
  const sourceAttrs: GridRowAttribute[] = [
    { item: "内容量", value: "500", unit: "ml", requirement: "必須" },
    { item: "ブランド名", value: "", unit: "", requirement: "任意" },
  ];

  it("同じカテゴリIDの行に値・単位をコピーし、別カテゴリの行は変えない", () => {
    const rows = [
      filledRow({ attributes: sourceAttrs }),
      filledRow({ mall_category_id: "110692" }),
      filledRow({ mall_category_id: "999999" }),
    ];
    const { rows: out, appliedRows } = copyAttributesToSameCategory(rows, 0);
    expect(appliedRows).toBe(1);
    expect(out[1].attributes?.[0]).toEqual({ item: "内容量", value: "500", unit: "ml", requirement: "必須" });
    expect(out[2].attributes).toBeUndefined();
  });

  it("コピー元が空の項目は、コピー先の入力済みの値を消さない", () => {
    const rows = [
      filledRow({ attributes: sourceAttrs }), // ブランド名は空
      filledRow({
        attributes: [{ item: "ブランド名", value: "バヤリース", unit: "", requirement: "任意" }],
      }),
    ];
    const { rows: out } = copyAttributesToSameCategory(rows, 0);
    expect(out[1].attributes).toEqual([
      { item: "内容量", value: "500", unit: "ml", requirement: "必須" },
      { item: "ブランド名", value: "バヤリース", unit: "", requirement: "任意" },
    ]);
  });

  it("コピー元に属性が無い・同カテゴリの行が無いときは何もしない", () => {
    const noAttrs = [filledRow(), filledRow()];
    expect(copyAttributesToSameCategory(noAttrs, 0).appliedRows).toBe(0);
    const noTargets = [filledRow({ attributes: sourceAttrs }), filledRow({ mall_category_id: "999999" })];
    const result = copyAttributesToSameCategory(noTargets, 0);
    expect(result.appliedRows).toBe(0);
    expect(result.rows).toBe(noTargets);
  });
});

describe("applyYahooToSameCategory（Yahoo候補を同カテゴリの行すべてへ）", () => {
  it("対象行を含む同カテゴリ全行の空欄だけ埋め、埋まった行数を返す", () => {
    const rows = [
      filledRow(),
      filledRow({ mall_category_id: "110692", yahoo_category_id: "手入力済", yahoo_path: "手入力＞パス" }),
      filledRow({ mall_category_id: "110692" }),
      filledRow({ mall_category_id: "999999" }),
    ];
    const { rows: out, appliedRows } = applyYahooToSameCategory(rows, 0, YAHOO);
    expect(appliedRows).toBe(2); // 0行目と2行目（1行目は入力済み・3行目は別カテゴリ）
    expect(out[0].yahoo_category_id).toBe("13457");
    expect(out[1].yahoo_category_id).toBe("手入力済"); // 手入力優先
    expect(out[2].yahoo_category_id).toBe("13457");
    expect(out[3].yahoo_category_id).toBe(""); // 別カテゴリは対象外
  });
});
