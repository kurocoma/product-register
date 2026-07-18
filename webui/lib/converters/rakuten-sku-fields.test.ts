import { describe, it, expect } from "vitest";
import { parseRakutenVariants } from "./rakuten-item-parser";
import { buildRakutenUpsertBody } from "./rakuten-api";
import { buildRakutenPatchBody, diffVariants } from "./rakuten-patch";
import { makeProduct, VariantSchema, type Variant } from "../product/schema";

/** SKU単位項目（表示価格 referencePrice・お届け目安 normalDeliveryDateId）の
 * 取込→編集→反映の整合テスト（260715: RMS の SKU別設定項目と WebUI/API の整合）。 */

const mkVar = (over: Record<string, unknown> = {}): Variant =>
  VariantSchema.parse({
    sku_manage_number: "k1",
    ne_code: "k1",
    jan_code: "4900000000001",
    selling_price: 1000,
    tax_rate: 8,
    quantity: 1,
    shipping_type: "送料無料",
    ...over,
  });

const itemJson = (variantOver: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "テスト商品",
  variants: {
    "k1": {
      merchantDefinedSkuId: "k1",
      standardPrice: "1000",
      ...variantOver,
    },
  },
});

describe("parseRakutenVariants — 表示価格(referencePrice)・納期ID(normalDeliveryDateId)の取込", () => {
  it("referencePrice.value(文字列) → display_price", () => {
    const vs = parseRakutenVariants(
      itemJson({ referencePrice: { displayType: "REFERENCE_PRICE", type: 1, value: "2894" } }),
    );
    expect(vs[0].display_price).toBe(2894);
  });

  it("referencePrice.value(数値) も取り込む（実機レスポンスは両表記あり）", () => {
    const vs = parseRakutenVariants(
      itemJson({ referencePrice: { displayType: "REFERENCE_PRICE", type: 1, value: 1000 } }),
    );
    expect(vs[0].display_price).toBe(1000);
  });

  it("referencePrice 無し → display_price 未設定", () => {
    const vs = parseRakutenVariants(itemJson());
    expect(vs[0].display_price).toBeUndefined();
  });

  it("SHOP_SETTING 等で value 無し → display_price 未設定", () => {
    const vs = parseRakutenVariants(itemJson({ referencePrice: { displayType: "SHOP_SETTING" } }));
    expect(vs[0].display_price).toBeUndefined();
  });

  it("normalDeliveryDateId(数値) → normal_delivery_date_id 文字列", () => {
    const vs = parseRakutenVariants(itemJson({ normalDeliveryDateId: 1 }));
    expect(vs[0].normal_delivery_date_id).toBe("1");
  });

  it("normalDeliveryDateId 欠落 → 空文字", () => {
    const vs = parseRakutenVariants(itemJson());
    expect(vs[0].normal_delivery_date_id).toBe("");
  });
});

describe("buildRakutenUpsertBody — SKU単位の referencePrice / normalDeliveryDateId 送信", () => {
  it("display_price>0 の variant に referencePrice を付ける（税別のため値は税抜のまま）", () => {
    const p = makeProduct({
      variants: [
        mkVar({ display_price: 15000, normal_delivery_date_id: "1" }),
        mkVar({ sku_manage_number: "k2", ne_code: "k2", jan_code: "4900000000002", selling_price: 2000 }),
      ],
    });
    const vs = buildRakutenUpsertBody(p).variants as Record<string, Record<string, unknown>>;
    expect(vs["k1"].referencePrice).toEqual({ displayType: "REFERENCE_PRICE", type: 1, value: "15000" });
    expect(vs["k1"].normalDeliveryDateId).toBe(1);
    expect("referencePrice" in vs["k2"]).toBe(false);
    expect("normalDeliveryDateId" in vs["k2"]).toBe(false);
  });

  it("単品(variants未設定)でも商品の表示価格(display_price)を referencePrice として送る", () => {
    const p = makeProduct({ display_price: 5000 });
    const vs = buildRakutenUpsertBody(p).variants as Record<string, Record<string, unknown>>;
    const v = Object.values(vs)[0];
    expect(v.referencePrice).toEqual({ displayType: "REFERENCE_PRICE", type: 1, value: "5000" });
  });

  it("単品で表示価格未設定(0)なら referencePrice を付けない", () => {
    const p = makeProduct({ display_price: 0 });
    const vs = buildRakutenUpsertBody(p).variants as Record<string, Record<string, unknown>>;
    expect("referencePrice" in Object.values(vs)[0]).toBe(false);
  });
});

describe("diffVariants — 表示価格・納期IDの差分検出", () => {
  it("表示価格の変更を検出する", () => {
    const snap = mkVar({ display_price: 15000 });
    const edited = mkVar({ display_price: 12000 });
    const fields = diffVariants([snap], [edited]).map((c) => c.field);
    expect(fields).toContain("SKU[k1].表示価格");
  });

  it("納期IDの変更を検出する", () => {
    const snap = mkVar({ normal_delivery_date_id: "1" });
    const edited = mkVar({ normal_delivery_date_id: "2" });
    const fields = diffVariants([snap], [edited]).map((c) => c.field);
    expect(fields).toContain("SKU[k1].納期ID");
  });

  it("同値なら差分なし", () => {
    const a = mkVar({ display_price: 15000, normal_delivery_date_id: "1" });
    const b = mkVar({ display_price: 15000, normal_delivery_date_id: "1" });
    expect(diffVariants([a], [b])).toEqual([]);
  });
});

describe("buildRakutenPatchBody — 表示価格・納期IDの部分更新", () => {
  it("変更された variant に referencePrice / normalDeliveryDateId を入れる", () => {
    const snap = mkVar({ display_price: 15000, normal_delivery_date_id: "1" });
    const edited = mkVar({ display_price: 12000, normal_delivery_date_id: "2" });
    const p = makeProduct({ variants: [edited] });
    const { body } = buildRakutenPatchBody([], p, { variants: [snap] });
    const vp = (body.variants as Record<string, Record<string, unknown>>)["k1"];
    expect(vp.referencePrice).toEqual({ displayType: "REFERENCE_PRICE", type: 1, value: "12000" });
    expect(vp.normalDeliveryDateId).toBe(2);
  });

  it("表示価格・納期IDの解除(空/0)は patch では送らず skipped で明示する", () => {
    const snap = mkVar({ display_price: 15000, normal_delivery_date_id: "1" });
    const edited = mkVar({});
    const p = makeProduct({ variants: [edited] });
    const { body, skipped } = buildRakutenPatchBody([], p, { variants: [snap] });
    const vp = (body.variants as Record<string, Record<string, unknown>> | undefined)?.["k1"];
    expect(vp?.referencePrice).toBeUndefined();
    expect(vp?.normalDeliveryDateId).toBeUndefined();
    expect(skipped.some((s) => s.includes("表示価格"))).toBe(true);
    expect(skipped.some((s) => s.includes("納期ID"))).toBe(true);
  });

  it("単品(variants未設定)の display_price 変更は referencePrice として patch する", () => {
    const p = makeProduct({ display_price: 5000 });
    const { body, skipped } = buildRakutenPatchBody(
      [{ field: "display_price", before: 0, after: 5000 }],
      p,
    );
    const vp = Object.values(body.variants as Record<string, Record<string, unknown>>)[0];
    expect(vp.referencePrice).toEqual({ displayType: "REFERENCE_PRICE", type: 1, value: "5000" });
    expect(skipped).not.toContain("display_price");
  });
});
