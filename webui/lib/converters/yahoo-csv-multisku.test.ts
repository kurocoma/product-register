import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { YahooConverter } from "./yahoo";

const conv = new YahooConverter();

/** 多SKUページ商品。フラット側(10000円/送料無料/JAN...2542)と variants[0] の値を変えて
 * 「variants[0] 代表で出力される」ことを検証できるようにする。 */
function makeMultiSku(overrides: Parameters<typeof makeProduct>[0] = {}) {
  return makeProduct({
    ne_code: "kmzt.i-0001-1",
    variants: [
      {
        sku_manage_number: "sku-a",
        ne_code: "kmzt.i-0001-1",
        jan_code: "4955028002559",
        selling_price: 1000,
        tax_rate: 10,
        quantity: 1,
        variation_value: "1本",
        shipping_type: "送料別",
      },
      {
        sku_manage_number: "sku-b",
        ne_code: "kmzt.i-0001-s01",
        jan_code: "4955028002566",
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

describe("YahooConverter multi-SKU (variants[0] 代表・設計書どおり従来1行)", () => {
  it("多SKU商品は1行のみ・price/jan/code は variants[0] 由来", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["code"]).toBe("kmzt.i-0001-1");
    expect(rows[0]["price"]).toBe("1100"); // 1000 * 1.1
    expect(rows[0]["jan"]).toBe("4955028002559");
  });

  it("ship-weight/delivery は variants[0] の shipping_type 由来", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[0]["ship-weight"]).toBe("1"); // 送料別（フラットは送料無料=100）
    expect(rows[0]["delivery"]).toBe("0");
  });

  it("taxrate-type は商品レベルの tax_rate 由来（variant側の古い値は使わない・260715修正）", () => {
    const p = makeMultiSku({ tax_rate: 8 });
    p.variants[0].tax_rate = 10; // variant 側が古いままでも
    const rows = conv.convert([p]);
    expect(rows[0]["taxrate-type"]).toBe("0.08");
    expect(rows[0]["price"]).toBe("1080"); // 1000 * 1.08
  });

  it("SKU別表示価格: variants[0].display_price を original-price(税込)に使う", () => {
    const p = makeMultiSku();
    p.variants[0].display_price = 1500;
    const rows = conv.convert([p]);
    expect(rows[0]["original-price"]).toBe("1650"); // 1500 * 1.1
  });

  // 後方互換の特性テスト（フラット商品の従来出力を固定する）
  it("後方互換: フラット商品は従来どおり flat フィールドで出力", () => {
    const rows = conv.convert([makeProduct({ display_price: 15000 })]);
    expect(rows[0]["price"]).toBe("11000"); // 10000 * 1.1
    expect(rows[0]["original-price"]).toBe("16500"); // 15000 * 1.1
    expect(rows[0]["jan"]).toBe("4955028002542");
    expect(rows[0]["ship-weight"]).toBe("100"); // 送料無料
  });
});
