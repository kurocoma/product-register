import { describe, it, expect } from "vitest";
import { rakutenIdToString, parseRakutenItem } from "./rakuten-item-parser";

describe("rakutenIdToString — 数値/文字列ID正規化", () => {
  it("数値 → 文字列", () => expect(rakutenIdToString(2)).toBe("2"));
  it("文字列 → トリム", () => expect(rakutenIdToString(" 10 ")).toBe("10"));
  it("空/欠落 → ''", () => {
    expect(rakutenIdToString(undefined)).toBe("");
    expect(rakutenIdToString(null)).toBe("");
    expect(rakutenIdToString("")).toBe("");
  });
});

function itemJson(opts: { group?: unknown; deliveryDateId?: unknown }): Record<string, unknown> {
  return {
    title: "X",
    variants: {
      "sku-1": {
        merchantDefinedSkuId: "ne-1",
        standardPrice: "1000",
        normalDeliveryDateId: opts.deliveryDateId,
        shipping: { postageIncluded: true, shippingMethodGroup: opts.group },
        attributes: [],
      },
    },
  };
}

describe("parseRakutenItem — 配送方法セット番号・納期管理番号を取込む", () => {
  it('shippingMethodGroup "10" / normalDeliveryDateId 1 を保持', () => {
    const p = parseRakutenItem(itemJson({ group: "10", deliveryDateId: 1 }));
    expect(p._rakutenShippingGroup).toBe("10");
    expect(p._rakutenDeliveryDateId).toBe("1");
  });
  it("数値 shippingMethodGroup 2 も文字列化", () => {
    expect(parseRakutenItem(itemJson({ group: 2 }))._rakutenShippingGroup).toBe("2");
  });
  it("既定便(未返却) → ''（既定行で賄う）", () => {
    const p = parseRakutenItem(itemJson({}));
    expect(p._rakutenShippingGroup).toBe("");
    expect(p._rakutenDeliveryDateId).toBe("");
  });
});
