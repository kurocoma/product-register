import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { ShopifyConverter, SHOPIFY_COLUMNS } from "./shopify";

const conv = new ShopifyConverter();

describe("ShopifyConverter", () => {
  it("outputs 60 columns in correct order", () => {
    const rows = conv.convert([makeProduct()]);
    expect(Object.keys(rows[0])).toEqual([...SHOPIFY_COLUMNS]);
  });

  it("Handle = base_code", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0].Handle).toBe("t002-2542");
  });

  it("image expansion: image_count=3 → 3 rows for 1 product", () => {
    const rows = conv.convert([makeProduct({ image_count: 3 })]);
    expect(rows).toHaveLength(3);
    expect(rows[0]["Image Position"]).toBe("1");
    expect(rows[1]["Image Position"]).toBe("2");
    expect(rows[2]["Image Position"]).toBe("3");
  });

  it("first row has Title + Body + Vendor", () => {
    const rows = conv.convert([makeProduct({ image_count: 3 })]);
    expect(rows[0].Title).toBe("巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度");
    expect(rows[0]["Body (HTML)"]).toContain("<!--imgList-->");
    expect(rows[0].Vendor).toContain("商品コード:t002-2542");
  });

  it("Published = true, Status = active", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0].Published).toBe("true");
    expect(rows[0].Status).toBe("active");
  });

  it("market columns: Included / 日本 + 国際", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0]["Included / 日本"]).toBe("true");
    expect(rows[0]["Included / 国際"]).toBe("true");
  });

  it("Variant Price = tax-inclusive", () => {
    const rows = conv.convert([makeProduct({ selling_price: 10000, tax_rate: 10 })]);
    expect(rows[0]["Variant Price"]).toBe("11000");
  });

  it("Variant Barcode = jan_code", () => {
    const rows = conv.convert([makeProduct({ jan_code: "4955028002542" })]);
    expect(rows[0]["Variant Barcode"]).toBe("4955028002542");
  });

  it("image-only rows (later positions) have only Handle/Image", () => {
    const rows = conv.convert([makeProduct({ image_count: 3 })]);
    // image_count=3, single product = 1 variant → row 1 has variant, rows 2-3 are image-only
    expect(rows[1].Title).toBe("");
    expect(rows[1]["Variant SKU"]).toBe("");
    expect(rows[1]["Image Position"]).toBe("2");
  });

  it("multiple variants share Handle, different SKU", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "t002-2542-1", quantity: 1, image_count: 3 }),
      makeProduct({ ne_code: "t002-2542-3", quantity: 3, product_type: "セット商品", image_count: 3 }),
    ]);
    expect(rows[0].Handle).toBe("t002-2542");
    expect(rows[0]["Variant SKU"]).toBe("t002-2542-1");
    expect(rows[1]["Variant SKU"]).toBe("t002-2542-3");
  });
});
