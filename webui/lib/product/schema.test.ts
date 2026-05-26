import { describe, it, expect } from "vitest";
import { ProductInputSchema, makeProduct } from "./schema";

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
