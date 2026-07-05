import { describe, it, expect } from "vitest";
import {
  ALL_GRID_COLUMNS,
  ATTRIBUTE_GRID_COLUMNS,
  BULK_GRID_ALL_COLUMNS,
  BULK_GRID_COLUMNS,
  buildProductsFromRows,
  columnGroups,
  emptyGridRow,
  gridRowToProductInput,
  type GridRow,
} from "./grid-rows";

/** 商品属性のグリッド列（フラット15列）のテスト。
 * カテゴリ読み込みの属性を右パネルではなくグリッド列（行方向）で入力できるようにする改修:
 * - ATTRIBUTE_GRID_COLUMNS: 項目・値・単位 ×5枠 = 15列（グループ「商品属性」）
 * - BULK_GRID_ALL_COLUMNS: 既存28列（BULK_GRID_COLUMNS）の後ろに15列を追加した43列
 * - gridRowToRaw: attribute_item_N のどれかが非空なら attributes[] をフラット15列から構築して
 *   row.attributes より優先する（列に入力した値が保存・変換・登録に確実に届く） */

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

describe("ATTRIBUTE_GRID_COLUMNS（商品属性の15列）", () => {
  it("項目・値・単位 ×5枠 = 15列を（項目→値→単位）の順で持つ", () => {
    expect(ATTRIBUTE_GRID_COLUMNS).toHaveLength(15);
    expect(ATTRIBUTE_GRID_COLUMNS.map((c) => c.key)).toEqual([
      "attribute_item_1", "attribute_value_1", "attribute_unit_1",
      "attribute_item_2", "attribute_value_2", "attribute_unit_2",
      "attribute_item_3", "attribute_value_3", "attribute_unit_3",
      "attribute_item_4", "attribute_value_4", "attribute_unit_4",
      "attribute_item_5", "attribute_value_5", "attribute_unit_5",
    ]);
    expect(ATTRIBUTE_GRID_COLUMNS.map((c) => c.label)).toEqual([
      "商品属性（項目）1", "商品属性（値）1", "商品属性（単位）1",
      "商品属性（項目）2", "商品属性（値）2", "商品属性（単位）2",
      "商品属性（項目）3", "商品属性（値）3", "商品属性（単位）3",
      "商品属性（項目）4", "商品属性（値）4", "商品属性（単位）4",
      "商品属性（項目）5", "商品属性（値）5", "商品属性（単位）5",
    ]);
  });

  it("全列グループ「商品属性」・text 入力（select 列の棚卸しを変えない）", () => {
    for (const c of ATTRIBUTE_GRID_COLUMNS) {
      expect(c.group).toBe("商品属性");
      expect(c.input).toBe("text");
    }
  });

  it("全列にテンプレート入力例（非空）がある", () => {
    for (const c of ATTRIBUTE_GRID_COLUMNS) {
      expect((c.example ?? "").trim(), `${c.label} の入力例が空`).not.toBe("");
    }
  });
});

describe("BULK_GRID_ALL_COLUMNS（既存28列 + 商品属性15列 = 43列）", () => {
  it("既存 BULK_GRID_COLUMNS を先頭にそのまま持ち、後ろに15列を追加する（既存列は不変）", () => {
    expect(BULK_GRID_ALL_COLUMNS).toHaveLength(BULK_GRID_COLUMNS.length + 15);
    expect(BULK_GRID_ALL_COLUMNS).toHaveLength(43);
    expect(BULK_GRID_ALL_COLUMNS.slice(0, BULK_GRID_COLUMNS.length)).toEqual(BULK_GRID_COLUMNS);
    expect(BULK_GRID_ALL_COLUMNS.slice(BULK_GRID_COLUMNS.length)).toEqual(ATTRIBUTE_GRID_COLUMNS);
  });

  it("列グループの末尾に「商品属性」（span 15）が加わる", () => {
    const groups = columnGroups(BULK_GRID_ALL_COLUMNS);
    expect(groups[groups.length - 1]).toEqual({ name: "商品属性", span: 15 });
    expect(groups.reduce((s, g) => s + g.span, 0)).toBe(BULK_GRID_ALL_COLUMNS.length);
  });

  it("emptyGridRow は新15列のプロパティを持たない（既存27列キー集合の互換維持 = optional 列）", () => {
    const row = emptyGridRow();
    for (const c of ATTRIBUTE_GRID_COLUMNS) {
      expect(c.key in row, `${c.key} が emptyGridRow に入っている`).toBe(false);
    }
    // 既存の単一源泉テストと同じ関係: emptyGridRow のキー = ALL_GRID_COLUMNS のキー + auto
    expect(Object.keys(row).filter((k) => k !== "auto").sort()).toEqual(
      ALL_GRID_COLUMNS.map((c) => c.key).sort(),
    );
  });
});

describe("gridRowToRaw のフラット属性 → ProductInput.attributes 優先規則", () => {
  it("attribute_item_N が非空ならフラット15列から attributes[] を構築し row.attributes より優先する", () => {
    const row = filledRow({
      attribute_item_1: " 内容量 ",
      attribute_value_1: " 500 ",
      attribute_unit_1: " ml ",
      // 行に古い attributes[] が残っていてもフラット列を優先する
      attributes: [{ item: "ブランド名", value: "バヤリース", unit: "", requirement: "任意" }],
    });
    const p = gridRowToProductInput(row);
    expect(p.attributes).toEqual([{ item: "内容量", value: "500", unit: "ml", requirement: "" }]);
    // フラット15列は trim して ProductInput の同名フィールドにも引き継ぐ
    expect(p.attribute_item_1).toBe("内容量");
    expect(p.attribute_value_1).toBe("500");
    expect(p.attribute_unit_1).toBe("ml");
  });

  it("空き枠（item 空）は飛ばし、入力のある枠だけを枠順で attributes[] にする", () => {
    const row = filledRow({
      attribute_item_1: "内容量",
      attribute_value_1: "500",
      attribute_unit_1: "ml",
      attribute_item_3: "果汁",
      attribute_value_3: "10",
      attribute_unit_3: "％",
    });
    const p = gridRowToProductInput(row);
    expect(p.attributes.map((a) => a.item)).toEqual(["内容量", "果汁"]);
  });

  it("item が全て空なら従来どおり row.attributes ?? [] を使う（値だけの枠は無視）", () => {
    const attrs = [{ item: "内容量", value: "500", unit: "ml", requirement: "必須" }];
    const withAttrs = gridRowToProductInput(filledRow({ attributes: attrs, attribute_value_1: "999" }));
    expect(withAttrs.attributes).toEqual(attrs);

    const without = gridRowToProductInput(filledRow());
    expect(without.attributes).toEqual([]);
  });

  it("バリエーション統合でも各SKU（variants[]）にフラット列由来の属性が入る", () => {
    const flat: Partial<GridRow> = {
      attribute_item_1: "内容量",
      attribute_value_1: "500",
      attribute_unit_1: "ml",
    };
    const rows = [
      filledRow({ ...flat, variation_key: "レモネード500" }),
      filledRow({
        ...flat,
        ne_code: "a009-4916-6",
        quantity: "6",
        product_type: "セット商品",
        selling_price: "1080",
        variation_key: "レモネード500",
      }),
    ];
    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1);
    const expected = [{ item: "内容量", value: "500", unit: "ml", requirement: "" }];
    expect(built[0].input?.attributes).toEqual(expected);
    expect(built[0].input?.variants.map((v) => v.attributes)).toEqual([expected, expected]);
  });
});
