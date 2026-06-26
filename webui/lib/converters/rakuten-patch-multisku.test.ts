import { describe, it, expect } from "vitest";
import { makeProduct, type Variant } from "../product/schema";
import { buildRakutenPatchBody, diffVariants } from "./rakuten-patch";

const V = (o: Partial<Variant>): Variant => ({
  sku_manage_number: "", ne_code: "", jan_code: "", selling_price: 0, tax_rate: 10, quantity: 1,
  variation_value: "", shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "",
  shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: [], ...o,
});
type VMap = Record<string, Record<string, unknown>>;

describe("diffVariants / buildRakutenPatchBody 多SKU(P5a-2)", () => {
  const snap = [
    V({ sku_manage_number: "k1", ne_code: "n1", jan_code: "4582469493419", selling_price: 1000, shipping_type: "送料別" }),
    V({ sku_manage_number: "k2", ne_code: "n2", jan_code: "4582469493426", selling_price: 3000, shipping_type: "送料別" }),
  ];

  it("diffVariants は変わったSKUだけ検出(価格)", () => {
    const edited = [{ ...snap[0], selling_price: 1100 }, snap[1]];
    const d = diffVariants(snap, edited);
    expect(d.map((c) => c.field)).toEqual(["SKU[k1].販売価格"]);
    expect(d[0].before).toBe(1000);
    expect(d[0].after).toBe(1100);
  });

  it("diffVariants は配送変更も検出(送料区分)", () => {
    const edited = [{ ...snap[0], postage_segment_1: "2" }, snap[1]];
    expect(diffVariants(snap, edited).map((c) => c.field)).toEqual(["SKU[k1].配送"]);
  });

  it("buildRakutenPatchBody 多SKU: 変わったSKUの変わった項目だけ variants に", () => {
    const edited = [
      V({ sku_manage_number: "k1", ne_code: "n1", jan_code: "4582469493419", selling_price: 1100, shipping_type: "送料無料" }),
      V({ sku_manage_number: "k2", ne_code: "n2", jan_code: "4582469493426", selling_price: 3000, shipping_type: "送料別" }),
    ];
    const changed = diffVariants(snap, edited);
    const { body } = buildRakutenPatchBody(changed, makeProduct({ variants: edited }), makeProduct({ variants: snap }));
    const vs = body.variants as VMap;
    expect(Object.keys(vs)).toEqual(["k1"]); // k2は不変→送らない
    expect(vs["k1"]).toMatchObject({ standardPrice: "1100", shipping: { postageIncluded: true } });
    expect(vs["k1"].articleNumber).toBeUndefined(); // JAN不変→送らない
  });

  it("送料別+送料区分の配送変更を variant.shipping に反映", () => {
    const edited = [{ ...snap[0], postage_segment_1: "1", shipping_method_group: "G9" }, snap[1]];
    const { body } = buildRakutenPatchBody(diffVariants(snap, edited), makeProduct({ variants: edited }), makeProduct({ variants: snap }));
    const vs = body.variants as VMap;
    expect(vs["k1"].shipping).toMatchObject({ postageIncluded: false, postageSegment: { local: 1 }, shippingMethodGroup: "G9" });
  });

  it("単品(variants未設定)は従来フラットpatch(後方互換)", () => {
    const p = makeProduct({ ne_code: "x1", rakuten_variant_id: "vk", selling_price: 500, jan_code: "4582469493419", shipping_type: "送料別" });
    const { body, variantId } = buildRakutenPatchBody([{ field: "selling_price", before: 400, after: 500 }], p, {});
    expect(variantId).toBe("vk");
    expect((body.variants as VMap)["vk"]).toMatchObject({ standardPrice: "500" });
  });
});
