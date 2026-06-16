import { describe, it, expect } from "vitest";
import { ProductInputSchema, makeProduct, resolveAttributes } from "./schema";

describe("resolveAttributes", () => {
  it("uses attributes array when present, filtering empty item names", () => {
    const p = makeProduct({
      attributes: [
        { item: "収録時間", value: "120", unit: "分" },
        { item: "", value: "x", unit: "" }, // item空は除外
        { item: "メーカー型番", value: "", unit: "" },
      ],
    });
    const r = resolveAttributes(p);
    expect(r.map((a) => a.item)).toEqual(["収録時間", "メーカー型番"]);
  });

  it("onlyWithValue keeps only attributes that have a value", () => {
    const p = makeProduct({
      attributes: [
        { item: "収録時間", value: "120", unit: "分" },
        { item: "メーカー型番", value: "", unit: "" },
      ],
    });
    const r = resolveAttributes(p, { onlyWithValue: true });
    expect(r.map((a) => a.item)).toEqual(["収録時間"]);
    expect(r[0].unit).toBe("分");
  });

  it("falls back to attribute_item_1..5 when attributes array is empty", () => {
    const p = makeProduct({
      attribute_item_1: "原材料",
      attribute_value_1: "米",
      attribute_unit_1: "",
      attribute_item_2: "",
    });
    const r = resolveAttributes(p);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ item: "原材料", value: "米", unit: "" });
  });
});

describe("ProductInputSchema", () => {
  it("accepts valid single product", () => {
    const p = makeProduct();
    expect(p.ne_code).toBe("t002-2542-1");
    expect(p.is_single).toBe(true);
    expect(p.is_set).toBe(false);
  });

  it("accepts valid set product", () => {
    const p = makeProduct({
      product_type: "セット商品",
      ne_code: "t002-2542-3",
      quantity: 3,
    });
    expect(p.is_set).toBe(true);
  });

  it("rejects invalid tax_rate", () => {
    expect(() => makeProduct({ tax_rate: 15 as 8 | 10 })).toThrow();
  });

  it("rejects invalid jan_code (not 13 digits)", () => {
    expect(() => makeProduct({ jan_code: "12345" })).toThrow();
  });

  it("yahoo_grouping_enabled defaults to false", () => {
    const raw = {
      ne_code: "x-0001-1",
      jan_code: "1234567890123",
      maker_code: "x",
      product_type: "単品" as const,
      quantity: 1,
      product_name: "X",
      display_name: "X",
      tax_rate: 10 as const,
      selling_price: 100,
      shipping_type: "送料別",
      image_count: 1,
      delivery_method: 4,
      lead_time: 1,
      mall_category_id: "0",
    };
    const p = ProductInputSchema.parse(raw);
    expect(p.yahoo_grouping_enabled).toBe(false);
    expect(p.unit).toBe("");
    expect(p.yahoo_variation_title).toBe("");
  });
});
