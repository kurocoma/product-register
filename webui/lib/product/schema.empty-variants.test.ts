/** 実質空の「ゴーストSKU」対策のテスト。
 * 背景（r0101-1 実件）: 「+ SKU追加」の空行がそのまま保存されると variants.length>0 になり
 * 多SKU扱いへ切り替わって、商品レベルの定期購入価格が無視され IE0433 が出続けた。
 * 対策: 実質空の variant は productVariants() で無視し、全部空ならフラット合成へ戻す。 */
import { describe, expect, it } from "vitest";
import { isEmptyVariant, pruneEmptyVariants, productVariants, makeProduct, VariantSchema } from "./schema";
import { validateSubscription } from "../converters/rakuten-api";

/** 「+ SKU追加」ボタンが作る空行そのもの（ProductForm の append デフォルトと同じ形） */
const ghostRow = () =>
  VariantSchema.parse({
    sku_manage_number: "", ne_code: "", jan_code: "", selling_price: 0, tax_rate: 10, quantity: 1,
    variation_value: "", image_url: "", shipping_type: "送料別",
  });

describe("isEmptyVariant / pruneEmptyVariants", () => {
  it("+ SKU追加の空行は実質空と判定する", () => {
    expect(isEmptyVariant(ghostRow())).toBe(true);
  });

  it("コード・価格・ラベル・定期価格・属性のどれかがあれば空ではない", () => {
    expect(isEmptyVariant(VariantSchema.parse({ ne_code: "r74-1" }))).toBe(false);
    expect(isEmptyVariant(VariantSchema.parse({ selling_price: 100 }))).toBe(false);
    expect(isEmptyVariant(VariantSchema.parse({ variation_value: "1個" }))).toBe(false);
    expect(isEmptyVariant(VariantSchema.parse({ subscription_base_price: 2200 }))).toBe(false);
    expect(
      isEmptyVariant(VariantSchema.parse({ attributes: [{ item: "内容量", value: "30本" }] })),
    ).toBe(false);
  });

  it("pruneEmptyVariants は空行だけ除去し実行内容のある行を残す", () => {
    const real = VariantSchema.parse({ ne_code: "r74-1", selling_price: 100 });
    expect(pruneEmptyVariants([ghostRow(), real, ghostRow()])).toEqual([real]);
    expect(pruneEmptyVariants([ghostRow()])).toEqual([]);
  });
});

describe("productVariants: ゴーストSKUの防御", () => {
  it("ゴーストだけの variants はフラット合成に戻る（定期価格も引き継ぐ）", () => {
    const p = makeProduct({
      ne_code: "r0101-1",
      selling_price: 2445,
      subscription_base_price: 2200,
      variants: [ghostRow()],
    });
    const vs = productVariants(p);
    expect(vs).toHaveLength(1);
    expect(vs[0].ne_code).toBe("r0101-1");
    expect(vs[0].selling_price).toBe(2445);
    expect(vs[0].subscription_base_price).toBe(2200);
  });

  it("実SKUとゴーストが混在したらゴーストだけ除いて返す", () => {
    const real = VariantSchema.parse({ ne_code: "r74-1", selling_price: 100 });
    const p = makeProduct({ variants: [ghostRow(), real] });
    expect(productVariants(p)).toEqual([real]);
  });
});

describe("validateSubscription: r0101-1 実件の回帰", () => {
  it("ゴーストSKU + 商品レベル定期価格2200で IE0433 を出さない", () => {
    const p = makeProduct({
      ne_code: "r0101-1",
      selling_price: 2445,
      subscription_enabled: true,
      subscription_shipping_date_flag: true,
      subscription_interval_flag: true,
      subscription_base_price: 2200,
      variants: [ghostRow()],
    });
    expect(validateSubscription(p)).toEqual({ ok: true });
  });
});
