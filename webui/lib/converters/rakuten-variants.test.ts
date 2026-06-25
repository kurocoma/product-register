import { describe, it, expect } from "vitest";
import { parseRakutenVariants } from "./rakuten-item-parser";

describe("parseRakutenVariants (多SKU取込 P2)", () => {
  const json = {
    variantSelectors: [{ key: "num-key", displayName: "数量", values: [{ displayValue: "1本" }, { displayValue: "24本" }] }],
    variants: {
      "sku-1": {
        merchantDefinedSkuId: "n050-3419-1",
        articleNumber: { value: "4582469493419" },
        standardPrice: "1637",
        selectorValues: { "num-key": "1本" },
        shipping: { postageIncluded: false },
        attributes: [{ name: "メーカー型番", values: ["X"] }],
      },
      "sku-2": {
        merchantDefinedSkuId: "n050-3419-s01",
        articleNumber: { value: "4582469493426" },
        standardPrice: "6,220", // 桁区切りカンマ
        selectorValues: { "num-key": "詰替セット" },
        shipping: { postageIncluded: true },
      },
    },
  };

  it("全variantをVariant[]化する", () => {
    const vs = parseRakutenVariants(json);
    expect(vs).toHaveLength(2);
    expect(vs.map((v) => v.ne_code)).toEqual(["n050-3419-1", "n050-3419-s01"]);
    expect(vs[0].sku_manage_number).toBe("sku-1");
    expect(vs[0].jan_code).toBe("4582469493419");
  });

  it("standardPrice の桁区切りカンマを除去して数値化する(6,220→6220)", () => {
    const vs = parseRakutenVariants(json);
    expect(vs[0].selling_price).toBe(1637);
    expect(vs[1].selling_price).toBe(6220); // "6,220" が 0 にならない
  });

  it("variation_value を selectorValues/variantSelectors から取得する", () => {
    const vs = parseRakutenVariants(json);
    expect(vs[0].variation_value).toBe("1本");
    expect(vs[1].variation_value).toBe("詰替セット");
  });

  it("送料無料/別を postageIncluded から判定", () => {
    const vs = parseRakutenVariants(json);
    expect(vs[0].shipping_type).toBe("送料別");
    expect(vs[1].shipping_type).toBe("送料無料");
  });

  it("merchantDefinedSkuId 欠落時は variantキーを ne_code に使う", () => {
    const vs = parseRakutenVariants({ variants: { vk1: { standardPrice: "100" } } });
    expect(vs[0].ne_code).toBe("vk1");
    expect(vs[0].jan_code).toBe(""); // articleNumber 無し
  });

  it("多軸の selectorValues は順序通り ' / ' で連結", () => {
    const multi = {
      variantSelectors: [{ key: "color-key" }, { key: "size-key" }],
      variants: { v1: { standardPrice: "100", selectorValues: { "color-key": "赤", "size-key": "S" } } },
    };
    expect(parseRakutenVariants(multi)[0].variation_value).toBe("赤 / S");
  });

  it("variants 無しは空配列", () => {
    expect(parseRakutenVariants({})).toEqual([]);
  });
});
