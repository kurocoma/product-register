import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { YahooConverter, YAHOO_COLUMNS } from "./yahoo";

const conv = new YahooConverter();

describe("YahooConverter", () => {
  it("outputs 85 columns in correct order", () => {
    const rows = conv.convert([makeProduct()]);
    expect(Object.keys(rows[0])).toHaveLength(85);
    expect(Object.keys(rows[0])).toEqual([...YAHOO_COLUMNS]);
  });

  it("code = ne_code", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0].code).toBe("t002-2542-1");
  });

  it("price = tax-inclusive (10000 * 1.1 = 11000)", () => {
    const rows = conv.convert([makeProduct({ selling_price: 10000, tax_rate: 10 })]);
    expect(rows[0].price).toBe("11000");
  });

  it("price 8% tax: 800 * 1.08 = 864", () => {
    const rows = conv.convert([makeProduct({ selling_price: 800, tax_rate: 8 })]);
    expect(rows[0].price).toBe("864");
  });

  it("taxrate-type 10% = 0.1", () => {
    const rows = conv.convert([makeProduct({ tax_rate: 10 })]);
    expect(rows[0]["taxrate-type"]).toBe("0.1");
  });

  it("taxrate-type 8% = 0.08", () => {
    const rows = conv.convert([makeProduct({ tax_rate: 8 })]);
    expect(rows[0]["taxrate-type"]).toBe("0.08");
  });

  it("grouping-id: enabled + ne_code ends with -N → trimmed", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "t002-2542-3", quantity: 3, yahoo_grouping_enabled: true }),
    ]);
    expect(rows[0]["grouping-id"]).toBe("t002-2542");
  });

  it("grouping-id: double-digit quantity", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "n019-0250-10", quantity: 10, yahoo_grouping_enabled: true }),
    ]);
    expect(rows[0]["grouping-id"]).toBe("n019-0250");
  });

  it("grouping-id: -S01 preserved (not trimmed)", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "t002-2542-S01", quantity: 1, yahoo_grouping_enabled: true }),
    ]);
    expect(rows[0]["grouping-id"]).toBe("t002-2542-S01");
  });

  it("grouping-id: disabled → empty", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: false })]);
    expect(rows[0]["grouping-id"]).toBe("");
  });

  it("variation1-spec-id always empty", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: true })]);
    expect(rows[0]["variation1-spec-id"]).toBe("");
  });

  it("variation1-free-title from yahoo_variation_title when enabled", () => {
    const rows = conv.convert([
      makeProduct({ yahoo_grouping_enabled: true, yahoo_variation_title: "数量" }),
    ]);
    expect(rows[0]["variation1-free-title"]).toBe("数量");
  });

  it("variation1-name: quantity=1 unit=袋 → 1袋", () => {
    const rows = conv.convert([
      makeProduct({ quantity: 1, unit: "袋", yahoo_grouping_enabled: true }),
    ]);
    expect(rows[0]["variation1-name"]).toBe("1袋");
  });

  it("variation1-name: quantity=5 unit=袋 → 5袋セット", () => {
    const rows = conv.convert([
      makeProduct({ quantity: 5, unit: "袋", yahoo_grouping_enabled: true }),
    ]);
    expect(rows[0]["variation1-name"]).toBe("5袋セット");
  });

  it("variation1-* empty when disabled", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: false })]);
    expect(rows[0]["variation1-free-title"]).toBe("");
    expect(rows[0]["variation1-name"]).toBe("");
  });

  it("variation2-5 all empty", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: true })]);
    for (const n of [2, 3, 4, 5]) {
      expect(rows[0][`variation${n}-spec-id`]).toBe("");
      expect(rows[0][`variation${n}-free-title`]).toBe("");
      expect(rows[0][`variation${n}-name`]).toBe("");
    }
  });

  it("item-image-urls: image_count=3 → 3 URLs", () => {
    const rows = conv.convert([makeProduct({ image_count: 3 })]);
    expect(rows[0]["item-image-urls"].split(";")).toHaveLength(3);
  });

  it("item-image-urls: image_count=1 → single URL", () => {
    const rows = conv.convert([makeProduct({ image_count: 1 })]);
    expect(rows[0]["item-image-urls"]).toBe(
      "https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg",
    );
  });

  it("item-image-urls: image_count=0 → empty", () => {
    const rows = conv.convert([makeProduct({ image_count: 0 })]);
    expect(rows[0]["item-image-urls"]).toBe("");
  });

  it("sp-additional equals caption", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0]["sp-additional"]).toBe(rows[0].caption);
  });

  it("original-price equals price", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0]["original-price"]).toBe(rows[0].price);
  });
});
