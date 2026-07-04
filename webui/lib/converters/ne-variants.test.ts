import { describe, it, expect } from "vitest";
import { makeProduct, productVariants } from "@/lib/product/schema";
import { NEConverter } from "./ne";

const conv = new NEConverter();

/** バリエーションキー統合後の多SKU商品（単品1 + 6本セット + 24本セット）。 */
function mergedProduct() {
  return makeProduct({
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    product_type: "単品",
    quantity: 1,
    selling_price: 200,
    tax_rate: 8,
    shipping_type: "送料別",
    variation_key: "レモネード500",
    rakuten_manage_number: "a009-4916",
    variants: [
      { sku_manage_number: "a009-4916-1", ne_code: "a009-4916-1", jan_code: "4514603474916", selling_price: 200, tax_rate: 8, quantity: 1, variation_value: "1本", shipping_type: "送料別" },
      { sku_manage_number: "a009-4916-6", ne_code: "a009-4916-6", jan_code: "4514603474916", selling_price: 1080, tax_rate: 8, quantity: 6, variation_value: "6本", shipping_type: "送料別" },
      { sku_manage_number: "a009-4916-24", ne_code: "a009-4916-24", jan_code: "4514603474916", selling_price: 4100, tax_rate: 8, quantity: 24, variation_value: "24本", shipping_type: "送料無料" },
    ],
  });
}

describe("NEConverter の多SKU（バリエーション統合商品）展開", () => {
  it("統合商品でも NE 用にはSKUごとに行が出る（数量1=単品・数量2以上=セット）", () => {
    const { singles, sets } = conv.convert([mergedProduct()]);
    expect(singles).toHaveLength(1);
    expect(sets).toHaveLength(2);
  });

  it("単品行はSKUのNEコード・価格・税率を使う", () => {
    const { singles } = conv.convert([mergedProduct()]);
    expect(singles[0].syohin_code).toBe("a009-4916-1");
    expect(singles[0].baika_tnk).toBe("200");
    expect(singles[0].tax_rate).toBe("8");
    expect(singles[0].jan_code).toBe("4514603474916");
    expect(singles[0].soryo_kbn).toBe("1"); // 送料別
    // 商品ページ共通項目は親商品から引き継ぐ
    expect(singles[0].syohin_name).toBe(mergedProduct().product_name);
  });

  it("セット行はSKUのNEコード・数量で従来のセット形（構成単品コード・suryo）を保つ", () => {
    const { sets } = conv.convert([mergedProduct()]);
    expect(sets[0].set_syohin_code).toBe("a009-4916-6");
    expect(sets[0].syohin_code).toBe("a009-4916-1"); // 構成単品 = 末尾を -1 に
    expect(sets[0].suryo).toBe("6");
    expect(sets[0].set_baika_tnk).toBe("1080");
    expect(sets[0].soryo_kbn).toBe("1");
    expect(sets[1].set_syohin_code).toBe("a009-4916-24");
    expect(sets[1].suryo).toBe("24");
    expect(sets[1].set_baika_tnk).toBe("4100");
    expect(sets[1].soryo_kbn).toBe("2"); // このSKUだけ送料無料
  });

  it("SKU別の画像URLはSKUのNEコードで従来規約どおり組み立てる", () => {
    const { singles, sets } = conv.convert([{ ...mergedProduct(), image_count: 3 }]);
    expect(singles[0].gazou_url1).toContain("/a009-4916-1.jpg");
    expect(singles[0].gazou_url2).toContain("/a009-4916_2.jpg"); // 単品は base_code
    expect(sets[0].gazou_url1).toContain("/a009-4916-6.jpg");
    expect(sets[0].gazou_url2).toContain("/a009-4916-6_2.jpg"); // セットはフルNEコード
  });

  it("フラット商品（variants未設定）は従来と同一の出力（後方互換・バイト同等）", () => {
    const single = makeProduct(); // variants = []
    const set = makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 });
    const result = conv.convert([single, set]);
    expect(result.singles).toHaveLength(1);
    expect(result.sets).toHaveLength(1);
    // フラット商品を「同値の1SKU」として表現しても行の内容が完全一致する
    // （= variants 展開がフラットの変換規則と同じフィールド対応であることの実証）
    const asVariant = conv.convert([
      { ...single, variants: productVariants(single) },
      { ...set, variants: productVariants(set) },
    ]);
    expect(asVariant.singles).toEqual(result.singles);
    expect(asVariant.sets).toEqual(result.sets);
  });
});
