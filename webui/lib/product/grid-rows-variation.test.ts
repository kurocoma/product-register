import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  ALL_GRID_COLUMNS,
  BULK_GRID_COLUMNS,
  TEMPLATE_NOTE,
  VARIATION_KEY_COLUMN,
  buildProductsFromRows,
  buildTemplateCsv,
  columnGroups,
  emptyGridRow,
  expandSetRows,
  gridRowToProductInput,
  parseTsv,
  type GridRow,
} from "./grid-rows";

const BOM = "﻿";

/** Excel がセルをコピーするときの TSV 表現。 */
function toTsvLine(cells: string[]): string {
  return cells
    .map((c) => (/[\t\n\r"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c))
    .join("\t");
}

/** 実データ相当（a009-4916 バヤリース島レモネード）の1行。 */
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
    cost_price: "123",
    selling_price: "200",
    shipping_type: "送料別",
    mall_category_id: "110692",
    auto: { ne_code: false, display_name: false },
    ...overrides,
  };
}

describe("バリエーションキー列（BULK_GRID_COLUMNS）", () => {
  it("既存27列の後ろにバリエーションキー列を持つ（既存列は不変）", () => {
    expect(BULK_GRID_COLUMNS).toHaveLength(ALL_GRID_COLUMNS.length + 1);
    expect(BULK_GRID_COLUMNS.slice(0, ALL_GRID_COLUMNS.length)).toEqual(ALL_GRID_COLUMNS);
    expect(BULK_GRID_COLUMNS[BULK_GRID_COLUMNS.length - 1]).toBe(VARIATION_KEY_COLUMN);
    expect(VARIATION_KEY_COLUMN.key).toBe("variation_key");
    expect(VARIATION_KEY_COLUMN.label).toBe("バリエーションキー");
  });

  it("列グループにバリエーションが加わる（既存6グループの後ろ）", () => {
    const groups = columnGroups(BULK_GRID_COLUMNS);
    expect(groups.map((g) => g.name)).toEqual([
      "基本情報", "価格", "配送", "カテゴリ", "商品説明", "Yahoo", "バリエーション",
    ]);
    expect(groups.reduce((s, g) => s + g.span, 0)).toBe(BULK_GRID_COLUMNS.length);
  });

  it("emptyGridRow は variation_key を持たない（既存27列の互換維持）が、セット行展開では引き継ぐ", () => {
    expect("variation_key" in emptyGridRow()).toBe(false);
    const sets = expandSetRows(filledRow({ variation_key: "レモネード500" }), [6]);
    expect(sets[0].variation_key).toBe("レモネード500");
  });
});

describe("parseTsv のバリエーションキー対応", () => {
  const fullRow = (variationKey: string) => [
    ...ALL_GRID_COLUMNS.map((c) => c.example ?? c.defaultValue ?? ""),
    variationKey,
  ];

  it("28列目をバリエーションキーとして取り込む", () => {
    const rows = parseTsv(toTsvLine(fullRow("レモネード500")));
    expect(rows).toHaveLength(1);
    expect(rows[0].variation_key).toBe("レモネード500");
    expect(rows[0].ne_code).toBe("a009-4916-1");
    expect(rows[0].unit).toBe("本"); // 27列目までは従来どおり
  });

  it("従来の27列・18列貼り付けではバリエーションキーは未設定のまま（後方互換）", () => {
    const legacy27 = parseTsv(toTsvLine(ALL_GRID_COLUMNS.map((c) => c.example ?? c.defaultValue ?? "")));
    expect(legacy27).toHaveLength(1);
    expect(legacy27[0].variation_key ?? "").toBe("");
  });

  it("先頭セルが「※」の説明行は読み飛ばす", () => {
    const tsv = [toTsvLine(fullRow("キー")), toTsvLine([TEMPLATE_NOTE])].join("\r\n");
    const rows = parseTsv(tsv);
    expect(rows).toHaveLength(1);
    expect(rows[0].ne_code).toBe("a009-4916-1");
    expect(parseTsv(toTsvLine([TEMPLATE_NOTE]))).toEqual([]);
  });
});

describe("buildProductsFromRows（バリエーションキー統合）", () => {
  it("キー無しの行は従来どおり 1行 = 1商品（gridRowToProductInput と同一）", () => {
    const row = filledRow();
    const built = buildProductsFromRows([row]);
    expect(built).toHaveLength(1);
    expect(built[0].variationKey).toBe("");
    expect(built[0].rowIndexes).toEqual([0]);
    expect(built[0].input).toEqual(gridRowToProductInput(row));
    expect(built[0].input!.variants).toEqual([]);
    expect(built[0].input!.rakuten_manage_number).toBe("");
  });

  it("同一キーの行は1商品に統合され variants[]（SKU別NEコード・価格・数量）になる", () => {
    const rows = [
      filledRow({ ne_code: "a009-4916-6", product_type: "セット商品", quantity: "6", selling_price: "1080", variation_key: "レモネード500" }),
      filledRow({ variation_key: "レモネード500" }), // 数量1 = 代表行
      filledRow({ ne_code: "a009-4916-24", product_type: "セット商品", quantity: "24", selling_price: "4100", shipping_type: "送料無料", variation_key: "レモネード500" }),
    ];
    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1);
    const p = built[0].input!;
    // 代表 = 数量最小行。rowIndexes も数量昇順
    expect(built[0].rowIndexes).toEqual([1, 0, 2]);
    expect(p.ne_code).toBe("a009-4916-1");
    expect(p.quantity).toBe(1);
    expect(p.selling_price).toBe(200);
    expect(p.is_single).toBe(true);
    // 統合キーと楽天商品管理番号（下9桁 base 形式 = メーカーコード-JAN下4桁）
    expect(p.variation_key).toBe("レモネード500");
    expect(p.rakuten_manage_number).toBe("a009-4916");
    // variants は数量昇順、SKUごとに NEコード（=システム連携用SKU番号）・価格・数量・送料区分を保持
    expect(p.variants.map((v) => v.ne_code)).toEqual(["a009-4916-1", "a009-4916-6", "a009-4916-24"]);
    expect(p.variants.map((v) => v.sku_manage_number)).toEqual(["a009-4916-1", "a009-4916-6", "a009-4916-24"]);
    expect(p.variants.map((v) => v.selling_price)).toEqual([200, 1080, 4100]);
    expect(p.variants.map((v) => v.quantity)).toEqual([1, 6, 24]);
    expect(p.variants.map((v) => v.jan_code)).toEqual(["4514603474916", "4514603474916", "4514603474916"]);
    expect(p.variants.map((v) => v.tax_rate)).toEqual([8, 8, 8]);
    expect(p.variants.map((v) => v.shipping_type)).toEqual(["送料別", "送料別", "送料無料"]);
    expect(p.variants.map((v) => v.variation_value)).toEqual(["1本", "6本", "24本"]);
  });

  it("バリエーション選択肢ラベルは単位列を使う（未入力は「本」）", () => {
    const rows = [
      filledRow({ unit: "袋", variation_key: "k" }),
      filledRow({ ne_code: "a009-4916-6", quantity: "6", selling_price: "1080", unit: "袋", variation_key: "k" }),
    ];
    const p = buildProductsFromRows(rows)[0].input!;
    expect(p.variants.map((v) => v.variation_value)).toEqual(["1袋", "6袋"]);
  });

  it("キー違い・キー無し・空行が混在しても出現順に別商品になる", () => {
    const rows = [
      filledRow({ ne_code: "a009-4916-1", variation_key: "A" }),
      emptyGridRow(), // 空行はスキップ
      filledRow({ ne_code: "b001-0001-1", jan_code: "4900000000017", maker_code: "b001" }), // キー無し
      filledRow({ ne_code: "a009-4916-6", quantity: "6", selling_price: "1080", variation_key: "A" }),
      filledRow({ ne_code: "c002-0002-1", jan_code: "4900000000024", maker_code: "c002", variation_key: "B" }),
    ];
    const built = buildProductsFromRows(rows);
    expect(built.map((b) => b.variationKey)).toEqual(["A", "", "B"]);
    expect(built[0].rowIndexes).toEqual([0, 3]);
    expect(built[0].input!.variants).toHaveLength(2);
    expect(built[1].rowIndexes).toEqual([2]);
    expect(built[1].input!.variants).toEqual([]);
    expect(built[2].rowIndexes).toEqual([4]);
    expect(built[2].input!.variants).toHaveLength(1);
    expect(built[2].input!.rakuten_manage_number).toBe("c002-0024"); // メーカーコード-JAN下4桁
  });

  it("1行だけのバリエーションキーでも variants 1件の統合商品になる（後からSKU追加できる形）", () => {
    const built = buildProductsFromRows([filledRow({ variation_key: "solo" })]);
    expect(built[0].input!.variants).toHaveLength(1);
    expect(built[0].input!.rakuten_manage_number).toBe("a009-4916");
    expect(built[0].input!.variation_key).toBe("solo");
  });

  it("グループ内に入力エラー行があると商品を作らず、全行に理由を返す（部分統合を防ぐ）", () => {
    const rows = [
      filledRow({ variation_key: "NG" }),
      filledRow({ ne_code: "a009-4916-6", quantity: "6", selling_price: "", variation_key: "NG" }), // 価格未入力
    ];
    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1);
    expect(built[0].input).toBeNull();
    // 自身のエラーが無い行には連帯スキップ理由
    expect(built[0].errors.get(0)?.join(" ")).toContain("統合保存をスキップ");
    // エラー行には自身の検証エラー
    expect(built[0].errors.get(1)?.join(" ")).toContain("販売価格");
  });

  it("キー無しの入力エラー行も input=null で理由を返す", () => {
    const built = buildProductsFromRows([filledRow({ jan_code: "bad" })]);
    expect(built[0].input).toBeNull();
    expect(built[0].errors.get(0)?.join(" ")).toContain("JANコード");
  });

  it("同一グループ内のNEコード重複は既存の重複検証で弾かれる", () => {
    const built = buildProductsFromRows([
      filledRow({ variation_key: "dup" }),
      filledRow({ variation_key: "dup" }), // 同じ ne_code
    ]);
    expect(built[0].input).toBeNull();
    expect(built[0].errors.get(1)?.join(" ")).toContain("重複");
  });
});

describe("バリエーションキー入りテンプレート（buildTemplateCsv(BULK_GRID_COLUMNS)）", () => {
  const parseCsv = (csv: string) =>
    (Papa.parse<string[]>(csv.replace(BOM, ""), { skipEmptyLines: true }).data ?? []);

  it("既定の27列テンプレは従来と同一（見出し+入力例の2行のみ）", () => {
    const data = parseCsv(buildTemplateCsv());
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual(ALL_GRID_COLUMNS.map((c) => c.label));
  });

  it("見出し28列 + 統合デモの入力例2行（同じキーの単品/セット）+ ※説明行を持つ", () => {
    const data = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
    expect(data).toHaveLength(4);
    expect(data[0]).toEqual(BULK_GRID_COLUMNS.map((c) => c.label));
    expect(data[0][data[0].length - 1]).toBe("バリエーションキー");
    const keyIdx = data[0].length - 1;
    // 2行の入力例は同じバリエーションキーで、NEコード・数量・価格が違う
    expect(data[1][keyIdx]).toBe("レモネード500");
    expect(data[2][keyIdx]).toBe("レモネード500");
    expect(data[1][0]).toBe("a009-4916-1");
    expect(data[2][0]).toBe("a009-4916-6");
    // 説明行: カテゴリはモール基本カテゴリIDのみ入力でOK（属性/Yahooは自動補完）の案内
    expect(data[3][0].startsWith("※")).toBe(true);
    expect(data[3][0]).toContain("モール基本カテゴリID");
    expect(data[3][0]).toContain("自動補完");
    expect(data[3][0]).toContain("バリエーションキー");
  });

  it("テンプレ往復: 貼り付け → 2行取込（※行はスキップ）→ 統合で1商品2SKUになる", () => {
    const data = parseCsv(buildTemplateCsv(BULK_GRID_COLUMNS));
    const tsv = data.map(toTsvLine).join("\r\n");
    const rows = parseTsv(tsv);
    expect(rows).toHaveLength(2); // 見出し行・※行は自動スキップ
    expect(rows.map((r) => r.variation_key)).toEqual(["レモネード500", "レモネード500"]);

    const built = buildProductsFromRows(rows);
    expect(built).toHaveLength(1);
    const p = built[0].input!;
    expect(p.variants).toHaveLength(2);
    expect(p.variants.map((v) => v.ne_code)).toEqual(["a009-4916-1", "a009-4916-6"]);
    expect(p.variants.map((v) => v.quantity)).toEqual([1, 6]);
    expect(p.variants.map((v) => v.selling_price)).toEqual([200, 1080]);
    expect(p.rakuten_manage_number).toBe("a009-4916");
    // カテゴリ列はモール基本カテゴリIDが入っていれば保存時に属性/Yahooを自動補完できる
    expect(p.mall_category_id).toBe("110692");
  });
});
