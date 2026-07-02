import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { ShopifyConverter, SHOPIFY_CDN_BASE } from "./shopify";

const conv = new ShopifyConverter();

/** 取込由来の多SKUページ商品（variants 2件・画像3枚）を作る。 */
function makeMultiSku(overrides: Parameters<typeof makeProduct>[0] = {}) {
  return makeProduct({
    ne_code: "kmzt.i-0001-1",
    image_count: 3,
    variants: [
      {
        sku_manage_number: "sku-a",
        ne_code: "kmzt.i-0001-1",
        jan_code: "4955028002542",
        selling_price: 1000,
        tax_rate: 10,
        quantity: 1,
        variation_value: "1本",
        shipping_type: "送料別",
      },
      {
        sku_manage_number: "sku-b",
        ne_code: "kmzt.i-0001-s01",
        jan_code: "4955028002559",
        selling_price: 2800,
        tax_rate: 10,
        quantity: 3,
        variation_value: "3本セット",
        shipping_type: "送料無料",
      },
    ],
    ...overrides,
  });
}

describe("ShopifyConverter multi-SKU (variants[]) CSV展開", () => {
  it("variants 2件+画像3枚 → 3行（行1=SKU1、行2=SKU2、行3=画像のみ）", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows).toHaveLength(3);
    expect(rows[0]["Variant SKU"]).toBe("kmzt.i-0001-1");
    expect(rows[1]["Variant SKU"]).toBe("kmzt.i-0001-s01");
    expect(rows[2]["Variant SKU"]).toBe("");
    expect(rows[2]["Image Position"]).toBe("3");
  });

  it("Variant Price は variant の税込価格、Barcode は variant の JAN", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[0]["Variant Price"]).toBe("1100"); // 1000 * 1.1
    expect(rows[0]["Variant Barcode"]).toBe("4955028002542");
    expect(rows[1]["Variant Price"]).toBe("3080"); // 2800 * 1.1
    expect(rows[1]["Variant Barcode"]).toBe("4955028002559");
  });

  it("Option1 Value は variation_value（送料無料variantは接尾辞付き）", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[0]["Option1 Value"]).toBe("1本");
    expect(rows[1]["Option1 Value"]).toBe("3本セット(送料無料)");
  });

  it("Variant Image は variant の ne_code を使う", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[0]["Variant Image"]).toBe(`${SHOPIFY_CDN_BASE}kmzt.i-0001-1.jpg`);
    expect(rows[1]["Variant Image"]).toBe(`${SHOPIFY_CDN_BASE}kmzt.i-0001-s01.jpg`);
  });

  it("SKU数が画像数を超えても SKU 行は落ちない", () => {
    const p = makeMultiSku({ image_count: 1 });
    p.variants.push({
      ...p.variants[1],
      sku_manage_number: "sku-c",
      ne_code: "kmzt.i-0001-s02",
      variation_value: "6本セット",
    });
    const rows = conv.convert([p]);
    expect(rows).toHaveLength(3);
    expect(rows[2]["Variant SKU"]).toBe("kmzt.i-0001-s02");
  });

  it("variation_name 未設定でも多SKUなら Option1 Name はセレクタ名になる", () => {
    const rows = conv.convert([makeMultiSku({ variation_name: "" })]);
    expect(rows[0]["Option1 Name"]).toBe("セット数を選んでください");
  });
});
