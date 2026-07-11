import { describe, it, expect } from "vitest";
import { paymentTaxRate, parseRakutenItem, parseRakutenVariants } from "./rakuten-item-parser";

/** 260711修正依頼-1「モールから取込で消費税率が取得出来ていない」の回帰テスト。
 * 実機 items.get（r135-10-1 / jelly1000 で確認）では税率は variant 直下ではなく
 * item 直下 payment.taxRate（文字列 "0.08"）にあり、旧実装は常に既定10へ倒れていた。 */

/** 実機レスポンス構造: payment.taxRate のみ・variant 直下に taxRate なし。 */
function realShapeJson(paymentTax: unknown, variantTax?: unknown): Record<string, unknown> {
  const variant: Record<string, unknown> = {
    merchantDefinedSkuId: "r135-10-1",
    standardPrice: "2221",
    articleNumber: { value: "4589837520005" },
    shipping: { postageIncluded: true },
    attributes: [],
  };
  if (variantTax !== undefined) variant.taxRate = variantTax;
  return {
    title: "スリムストンコーヒー 10本",
    payment: { taxIncluded: false, taxRate: paymentTax, cashOnDeliveryFeeIncluded: false },
    variants: { "r135-10-1": variant },
  };
}

describe("paymentTaxRate — item直下 payment.taxRate の読み取り", () => {
  it('"0.08" → 8（実機の軽減税率商品）', () => expect(paymentTaxRate(realShapeJson("0.08"))).toBe(8));
  it('"0.1" → 10', () => expect(paymentTaxRate(realShapeJson("0.1"))).toBe(10));
  it("payment 自体が無い → undefined", () => expect(paymentTaxRate({ title: "X" })).toBeUndefined());
  it("taxRate 欠落 → undefined", () => expect(paymentTaxRate(realShapeJson(undefined))).toBeUndefined());
});

describe("parseRakutenItem — 実機構造（variant直下にtaxRateなし）で payment.taxRate を採用", () => {
  it('payment.taxRate "0.08" → tax_rate 8（依頼の再現ケース: 従来は既定10に倒れていた）', () =>
    expect(parseRakutenItem(realShapeJson("0.08")).tax_rate).toBe(8));
  it('payment.taxRate "0.1" → tax_rate 10', () =>
    expect(parseRakutenItem(realShapeJson("0.1")).tax_rate).toBe(10));
  it("variant 直下に taxRate が来る場合はそちらを優先（後方互換）", () =>
    expect(parseRakutenItem(realShapeJson("0.08", 0.1)).tax_rate).toBe(10));
  it("どちらも無い → tax_rate を設定しない（取込既定10へ委ねる）", () =>
    expect(parseRakutenItem(realShapeJson(undefined)).tax_rate).toBeUndefined());
});

describe("parseRakutenVariants — 各SKUも payment.taxRate へフォールバック", () => {
  it('payment.taxRate "0.08" → 全SKU tax_rate 8', () =>
    expect(parseRakutenVariants(realShapeJson("0.08"))[0].tax_rate).toBe(8));
  it("variant 直下優先（後方互換）", () =>
    expect(parseRakutenVariants(realShapeJson("0.1", 0.08))[0].tax_rate).toBe(8));
  it("どちらも無い → 既定10", () =>
    expect(parseRakutenVariants(realShapeJson(undefined))[0].tax_rate).toBe(10));
});
