import { describe, it, expect } from "vitest";
import { parseTaxRate, parseRakutenItem, parseRakutenVariants } from "./rakuten-item-parser";

/** 楽天 items.get の taxRate（軽減8%/標準10%が商品ごとに混在）を実値採用する回帰テスト。 */
describe("parseTaxRate — 楽天 taxRate(小数) → アプリ百分率", () => {
  it("0.08 → 8（軽減税率・食品）", () => expect(parseTaxRate(0.08)).toBe(8));
  it('"0.1" → 10（文字列）', () => expect(parseTaxRate("0.1")).toBe(10));
  it("0.1 → 10", () => expect(parseTaxRate(0.1)).toBe(10));
  it("百分率 8/10 も拾う", () => {
    expect(parseTaxRate(8)).toBe(8);
    expect(parseTaxRate(10)).toBe(10);
  });
  it("欠落/空/非数 → undefined（呼び出し側で既定10へ）", () => {
    expect(parseTaxRate(undefined)).toBeUndefined();
    expect(parseTaxRate("")).toBeUndefined();
    expect(parseTaxRate(null)).toBeUndefined();
    expect(parseTaxRate("abc")).toBeUndefined();
  });
  it("想定外の率 → undefined（安全に既定へ）", () => {
    expect(parseTaxRate(0.05)).toBeUndefined();
    expect(parseTaxRate(0)).toBeUndefined();
  });
});

function itemJson(taxRate: unknown): Record<string, unknown> {
  return {
    title: "X",
    variants: {
      "sku-1": {
        merchantDefinedSkuId: "ne-1",
        standardPrice: "1000",
        taxRate,
        articleNumber: { value: "4900000000000" },
        shipping: { postageIncluded: true },
        attributes: [],
      },
    },
  };
}

describe("parseRakutenItem — 税率は楽天の実値を採用（既定10を上書き）", () => {
  it("taxRate 0.08 → tax_rate 8", () => expect(parseRakutenItem(itemJson(0.08)).tax_rate).toBe(8));
  it('taxRate "0.1" → tax_rate 10', () => expect(parseRakutenItem(itemJson("0.1")).tax_rate).toBe(10));
  it("taxRate 未返却 → tax_rate を設定しない（取込既定10へ委ねる）", () =>
    expect(parseRakutenItem(itemJson(undefined)).tax_rate).toBeUndefined());
});

describe("parseRakutenVariants — 各SKUの税率を楽天実値で", () => {
  it("taxRate 0.08 → tax_rate 8", () => expect(parseRakutenVariants(itemJson(0.08))[0].tax_rate).toBe(8));
  it("taxRate 未返却 → 既定10", () => expect(parseRakutenVariants(itemJson(undefined))[0].tax_rate).toBe(10));
});
