import { describe, it, expect } from "vitest";
import { makeProduct, productVariants, VariantSchema, ProductInputSchema } from "./schema";

describe("productVariants (多SKU後方互換ヘルパ)", () => {
  it("variants 未設定の単品はフラットから1件合成する", () => {
    const p = makeProduct({ ne_code: "n050-3426-1", jan_code: "4582469493426", selling_price: 814, shipping_type: "送料無料" });
    const vs = productVariants(p);
    expect(vs).toHaveLength(1);
    expect(vs[0].ne_code).toBe("n050-3426-1");
    expect(vs[0].jan_code).toBe("4582469493426");
    expect(vs[0].selling_price).toBe(814);
    expect(vs[0].shipping_type).toBe("送料無料");
    // sku_manage_number は rakuten_variant_id 優先、無ければ ne_code
    expect(vs[0].sku_manage_number).toBe("n050-3426-1");
  });

  it("rakuten_variant_id があれば sku_manage_number に使う", () => {
    const p = makeProduct({ ne_code: "m043-3425-1", rakuten_variant_id: "ppork5" });
    expect(productVariants(p)[0].sku_manage_number).toBe("ppork5");
  });

  it("variants[] があればそれをそのまま返す(合成しない)", () => {
    const p = makeProduct({
      variants: [
        { sku_manage_number: "n050-3419-1", ne_code: "n050-3419-1", jan_code: "4582469493419", selling_price: 1080, tax_rate: 10, quantity: 1 },
        { sku_manage_number: "n050-3419-s01", ne_code: "n050-3419-s01", jan_code: "4582469493426", selling_price: 3120, tax_rate: 10, quantity: 1 },
      ],
    });
    const vs = productVariants(p);
    expect(vs).toHaveLength(2);
    expect(vs.map((v) => v.ne_code)).toEqual(["n050-3419-1", "n050-3419-s01"]);
    expect(vs[1].selling_price).toBe(3120);
  });

  it("VariantSchema は配送詳細に既定値を入れる(置き配=true・送料区分空)", () => {
    const v = VariantSchema.parse({ ne_code: "x", selling_price: 100 });
    expect(v.okihai).toBe(true);
    expect(v.shipping_type).toBe("送料別");
    expect(v.postage_segment_1).toBe("");
    expect(v.shipping_method_group).toBe("");
  });

  it("variants は extra 往復で保持される(parse で既定[]、値があれば保持)", () => {
    expect(makeProduct().variants).toEqual([]);
    const round = ProductInputSchema.parse({ ...ProductInputSchema.parse(makeProduct()), variants: [{ ne_code: "a", selling_price: 1 }] });
    expect(round.variants).toHaveLength(1);
    expect(round.variants[0].ne_code).toBe("a");
  });
});
