import { describe, expect, it } from "vitest";
import { makeProduct } from "@/lib/product";
import {
  applyJanPriceEdits,
  buildJanPriceRows,
  janPriceRowKeyOf,
  parseJanCodes,
} from "./jan-price";

const JAN_A = "4900000000011";
const JAN_B = "4900000000028";

describe("parseJanCodes — JAN貼り付け入力の分類", () => {
  it("改行/カンマ混在を分割し、13桁のみ valid にする", () => {
    const r = parseJanCodes(`${JAN_A}\n${JAN_B},12345\nabc`);
    expect(r.valid).toEqual([JAN_A, JAN_B]);
    expect(r.invalid.map((i) => i.raw)).toEqual(["12345", "abc"]);
  });
  it("完全一致の重複は除去して件数を数える", () => {
    const r = parseJanCodes([JAN_A, JAN_A, JAN_A]);
    expect(r.valid).toEqual([JAN_A]);
    expect(r.duplicatesRemoved).toBe(2);
  });
});

describe("buildJanPriceRows — 商品/SKU/セット混在の一覧行", () => {
  it("フラット商品（単品）は variantKey='' の1行・税込は楽天/Yahooとも切り捨て", () => {
    const p = makeProduct({ jan_code: JAN_A, selling_price: 3912, tax_rate: 8 });
    const rows = buildJanPriceRows("id1", "r100", p, new Set([JAN_A]), new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: "id1",
      key: "r100",
      variantKey: "",
      jan: JAN_A,
      matched: true,
      taxRate: 8,
      currentNet: 3912,
      // 3912 × 1.08 = 4224.96 → 実測どおり 4224（切り捨て）
      currentRakutenGross: 4224,
      currentYahooGross: 4224,
    });
  });

  it("多SKU商品（単品＋セットが同一JAN）は SKU 行で表示し、一致行に matched が付く", () => {
    const p = makeProduct({
      product_type: "セット商品",
      variants: [
        { sku_manage_number: "r200-1", ne_code: "r200-1", jan_code: JAN_A, selling_price: 1000, variation_value: "1本" },
        { sku_manage_number: "r200-2", ne_code: "r200-2", jan_code: JAN_A, selling_price: 1800, variation_value: "2本セット" },
        { sku_manage_number: "r200-9", ne_code: "r200-9", jan_code: JAN_B, selling_price: 500, variation_value: "別JAN" },
      ],
    });
    const rows = buildJanPriceRows("id2", "r200", p, new Set([JAN_A]), new Map());
    expect(rows.map((r) => r.variantKey)).toEqual(["r200-1", "r200-2", "r200-9"]);
    expect(rows.map((r) => r.matched)).toEqual([true, true, false]);
    // 税率は商品レベルが正（10%）
    expect(rows[0].currentRakutenGross).toBe(1100);
    expect(rows[1].currentRakutenGross).toBe(1980);
  });

  it("編集済みの行には新税抜と新税込（楽天/Yahoo）が付く", () => {
    const p = makeProduct({ jan_code: JAN_A, selling_price: 1000 });
    const edits = new Map([[janPriceRowKeyOf("id1", ""), 900]]);
    const rows = buildJanPriceRows("id1", "r100", p, new Set([JAN_A]), edits);
    expect(rows[0].newNet).toBe(900);
    expect(rows[0].newRakutenGross).toBe(990);
    expect(rows[0].newYahooGross).toBe(990);
  });
});

describe("applyJanPriceEdits — 価格の適用", () => {
  it("フラット商品: variantKey='' の編集で selling_price を更新し changes を返す", () => {
    const p = makeProduct({ selling_price: 1000 });
    const r = applyJanPriceEdits("id1", p, [{ productId: "id1", variantKey: "", newNet: 1200 }]);
    expect(r.errors).toEqual([]);
    expect(r.mutated.selling_price).toBe(1200);
    expect(r.changes).toEqual([{ field: "selling_price", before: 1000, after: 1200 }]);
  });

  it("多SKU商品: 指定SKUだけ更新し、他SKUは変更しない", () => {
    const p = makeProduct({
      variants: [
        { sku_manage_number: "r200-1", ne_code: "r200-1", jan_code: JAN_A, selling_price: 1000 },
        { sku_manage_number: "r200-2", ne_code: "r200-2", jan_code: JAN_A, selling_price: 1800 },
      ],
    });
    const r = applyJanPriceEdits("id2", p, [{ productId: "id2", variantKey: "r200-2", newNet: 1700 }]);
    expect(r.errors).toEqual([]);
    expect(r.mutated.variants[0].selling_price).toBe(1000);
    expect(r.mutated.variants[1].selling_price).toBe(1700);
    expect(r.changes).toEqual([
      { field: "selling_price", variantKey: "r200-2", before: 1800, after: 1700 },
    ]);
  });

  it("他商品の編集は無視・現在と同額はno-op・不明SKU/不正値はエラー", () => {
    const p = makeProduct({ selling_price: 1000 });
    const same = applyJanPriceEdits("id1", p, [{ productId: "id1", variantKey: "", newNet: 1000 }]);
    expect(same.changes).toEqual([]);
    const other = applyJanPriceEdits("id1", p, [{ productId: "idX", variantKey: "", newNet: 500 }]);
    expect(other.changes).toEqual([]);
    expect(other.errors).toEqual([]);
    const bad = applyJanPriceEdits("id1", p, [
      { productId: "id1", variantKey: "", newNet: 0 },
      { productId: "id1", variantKey: "", newNet: 1.5 },
    ]);
    expect(bad.errors).toHaveLength(2);
    const missing = applyJanPriceEdits(
      "id2",
      makeProduct({ variants: [{ sku_manage_number: "r200-1", ne_code: "r200-1", selling_price: 100 }] }),
      [{ productId: "id2", variantKey: "nope", newNet: 200 }],
    );
    expect(missing.errors[0]).toContain("nope");
  });
});
