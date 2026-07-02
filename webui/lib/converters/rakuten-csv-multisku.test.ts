import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { RakutenConverter } from "./rakuten";

const conv = new RakutenConverter();

/** 取込由来の多SKUページ商品（非規約書式の管理番号 + variants 2件）を作る。 */
function makeMultiSku() {
  return makeProduct({
    ne_code: "kmzt.i-0001-1",
    rakuten_manage_number: "kmzt.i-0001",
    variants: [
      {
        sku_manage_number: "sku-a",
        ne_code: "kmzt.i-0001-1",
        jan_code: "4955028002542",
        selling_price: 1000,
        quantity: 1,
        variation_value: "1本",
        shipping_type: "送料別",
      },
      {
        sku_manage_number: "sku-b",
        ne_code: "kmzt.i-0001-s01",
        jan_code: "4955028002559",
        selling_price: 2800,
        quantity: 3,
        variation_value: "3本セット",
        shipping_type: "送料無料",
      },
    ],
  });
}

describe("RakutenConverter multi-SKU (variants[]) CSV展開", () => {
  it("variants 2件 → 親1行 + 子2行に展開する", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows).toHaveLength(3);
    expect(rows[0]["SKU管理番号"]).toBe("");
    expect(rows[1]["SKU管理番号"]).toBe("sku-a");
    expect(rows[2]["SKU管理番号"]).toBe("sku-b");
  });

  it("商品管理番号は rakuten_manage_number を優先する（非規約書式の取込商品）", () => {
    const rows = conv.convert([makeMultiSku()]);
    for (const r of rows) {
      expect(r["商品管理番号（商品URL）"]).toBe("kmzt.i-0001");
    }
  });

  it("子行の販売価格・システム連携用SKU番号・カタログIDは variant 由来", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[1]["販売価格"]).toBe("1000");
    expect(rows[1]["システム連携用SKU番号"]).toBe("kmzt.i-0001-1");
    expect(rows[1]["カタログID"]).toBe("4955028002542");
    expect(rows[2]["販売価格"]).toBe("2800");
    expect(rows[2]["システム連携用SKU番号"]).toBe("kmzt.i-0001-s01");
    expect(rows[2]["カタログID"]).toBe("4955028002559");
  });

  it("バリエーション項目選択肢1 は variant.variation_value を使う", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[1]["バリエーション項目選択肢1"]).toBe("1本");
    expect(rows[2]["バリエーション項目選択肢1"]).toBe("3本セット");
  });

  it("送料は variant の shipping_type から SKU別に出す", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[1]["送料"]).toBe("0"); // 送料別
    expect(rows[2]["送料"]).toBe("1"); // 送料無料
  });

  it("多SKU商品の SKU画像パスは variant の ne_code を使う", () => {
    const rows = conv.convert([makeMultiSku()]);
    expect(rows[1]["SKU画像タイプ"]).toBe("CABINET");
    expect(rows[1]["SKU画像パス"]).toBe("/thum02/kmzt.i-0001-1.jpg");
    expect(rows[2]["SKU画像パス"]).toBe("/thum02/kmzt.i-0001-s01.jpg");
  });

  it("SKU別の表示価格: variant.display_price があればそれ、無ければ販売価格に連動", () => {
    const p = makeMultiSku();
    p.variants[0].display_price = 1500;
    const rows = conv.convert([p]);
    expect(rows[1]["表示価格"]).toBe("1500");
    expect(rows[2]["表示価格"]).toBe("2800"); // 未設定 → selling_price
  });

  // 後方互換の特性テスト（フラット商品の従来出力を固定する）
  it("後方互換: フラット商品の 表示価格 は product の display_price を使う", () => {
    const rows = conv.convert([makeProduct({ selling_price: 10000, display_price: 15000 })]);
    expect(rows[1]["表示価格"]).toBe("15000");
  });
});
