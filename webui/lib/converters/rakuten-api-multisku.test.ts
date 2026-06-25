import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody } from "./rakuten-api";

type Variants = Record<string, Record<string, unknown>>;
const variantsOf = (p: Parameters<typeof buildRakutenUpsertBody>[0]) =>
  buildRakutenUpsertBody(p).variants as Variants;

describe("buildRakutenUpsertBody 多SKU(P5a)", () => {
  it("単品(variants未設定)は1 variant・従来互換", () => {
    const p = makeProduct({ ne_code: "t002-2542-1", jan_code: "4955028002542", selling_price: 10000, shipping_type: "送料無料" });
    const vs = variantsOf(p);
    expect(Object.keys(vs)).toEqual(["t002-2542-1"]);
    expect(vs["t002-2542-1"]).toMatchObject({
      merchantDefinedSkuId: "t002-2542-1",
      standardPrice: "10000",
      articleNumber: { value: "4955028002542" },
      shipping: { postageIncluded: true },
    });
  });

  it("rakuten_variant_id があれば variantキーに使う(従来互換)", () => {
    const p = makeProduct({ ne_code: "m043-3425-1", rakuten_variant_id: "ppork5", selling_price: 426 });
    expect(Object.keys(variantsOf(p))).toEqual(["ppork5"]);
    expect(variantsOf(p)["ppork5"]).toMatchObject({ merchantDefinedSkuId: "m043-3425-1", standardPrice: "426" });
  });

  it("多SKUは全variantを展開(価格・JAN・NE連携番号・送料)", () => {
    const p = makeProduct({
      variants: [
        { sku_manage_number: "n050-3419-1", ne_code: "n050-3419-1", jan_code: "4582469493419", selling_price: 1637, tax_rate: 10, quantity: 1, shipping_type: "送料無料" },
        { sku_manage_number: "n050-3419-s01", ne_code: "n050-3419-s01", jan_code: "4582469493426", selling_price: 3120, tax_rate: 10, quantity: 1, shipping_type: "送料別", postage_segment_1: "1", shipping_method_group: "G1" },
      ],
    });
    const vs = variantsOf(p);
    expect(Object.keys(vs).sort()).toEqual(["n050-3419-1", "n050-3419-s01"]);
    expect(vs["n050-3419-1"]).toMatchObject({ merchantDefinedSkuId: "n050-3419-1", standardPrice: "1637", articleNumber: { value: "4582469493419" }, shipping: { postageIncluded: true } });
    expect(vs["n050-3419-s01"]).toMatchObject({
      merchantDefinedSkuId: "n050-3419-s01",
      standardPrice: "3120",
      shipping: { postageIncluded: false, postageSegment: { local: 1 }, shippingMethodGroup: "G1" },
    });
  });

  it("送料別: 個別送料は送料区分と排他(feeのみ送る)", () => {
    const p = makeProduct({
      variants: [{ sku_manage_number: "a", ne_code: "a", jan_code: "4582469493419", selling_price: 500, tax_rate: 10, quantity: 1, shipping_type: "送料別", individual_shipping_fee: "300", postage_segment_1: "1" }],
    });
    const sh = variantsOf(p)["a"].shipping as Record<string, unknown>;
    expect(sh).toMatchObject({ postageIncluded: false, fee: "300" });
    expect(sh.postageSegment).toBeUndefined();
  });

  it("送料無料は postageIncluded のみ(fee/区分を送らない)", () => {
    const p = makeProduct({
      variants: [{ sku_manage_number: "a", ne_code: "a", jan_code: "4582469493419", selling_price: 500, tax_rate: 10, quantity: 1, shipping_type: "送料無料", individual_shipping_fee: "300", postage_segment_1: "1" }],
    });
    expect(variantsOf(p)["a"].shipping).toEqual({ postageIncluded: true });
  });
});
