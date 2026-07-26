import { describe, it, expect } from "vitest";
import { parseRakutenItem } from "./rakuten-item-parser";

// 多SKUページのSKU選択（260726実件の回帰テスト）。
// 楽天側で merchantDefinedSkuId が3SKUとも同じ値（r8389-1）という実データがあり、
// merchantDefinedSkuId 一致だけで選ぶと 5袋SKU(12284円)を 1袋商品として掴んでいた。
// 取込値はそのまま Yahoo へ反映されるため、SKU選択の誤りは価格破壊に直結する。

function variant(msku: string, price: string, jan: string) {
  return { merchantDefinedSkuId: msku, standardPrice: price, articleNumber: { value: jan }, attributes: [] };
}

const base = { title: "テスト", payment: { taxRate: "0.08" } };

describe("parseRakutenItem — 多SKUページのSKU選択", () => {
  it("merchantDefinedSkuId が一意ならそれを採用する（従来動作）", () => {
    const json = {
      ...base,
      variants: {
        "k-5": variant("x-5", "5000", "4900000000005"),
        "k-1": variant("x-1", "1000", "4900000000001"),
      },
    };
    const p = parseRakutenItem(json, { merchantSku: "x-1" });
    expect(p.selling_price).toBe(1000);
    expect(p.rakuten_variant_id).toBe("k-1");
  });

  it("merchantDefinedSkuId が全SKUで重複する場合は SKU管理番号(variantキー)で解決する", () => {
    const json = {
      ...base,
      variants: {
        "r8389-5": variant("r8389-1", "12284", "4900000000005"),
        "r8389-3": variant("r8389-1", "7779", "4900000000003"),
        "r8389-1": variant("r8389-1", "2730", "4900000000001"),
      },
    };
    const p = parseRakutenItem(json, { merchantSku: "r8389-1" });
    expect(p.selling_price).toBe(2730); // 12284(5袋) を掴んだら不合格
    expect(p.rakuten_variant_id).toBe("r8389-1");
    expect(p.jan_code).toBe("4900000000001");
  });

  it("merchantDefinedSkuId が一致しなくても variantキーが一致すればそれを採用する", () => {
    const json = {
      ...base,
      variants: {
        "k-5": variant("x-5", "5000", "4900000000005"),
        "k-1": variant("", "1000", "4900000000001"),
      },
    };
    const p = parseRakutenItem(json, { merchantSku: "k-1" });
    expect(p.selling_price).toBe(1000);
    expect(p.rakuten_variant_id).toBe("k-1");
  });

  it("どちらも一致しなければ先頭SKUへフォールバックする（取込を止めない）", () => {
    const json = {
      ...base,
      variants: {
        "k-5": variant("x-5", "5000", "4900000000005"),
        "k-1": variant("x-1", "1000", "4900000000001"),
      },
    };
    const p = parseRakutenItem(json, { merchantSku: "not-on-page" });
    expect(p.selling_price).toBe(5000);
  });

  it("merchantSku 未指定は先頭SKU（既存呼び出しの互換）", () => {
    const json = {
      ...base,
      variants: {
        "k-5": variant("x-5", "5000", "4900000000005"),
        "k-1": variant("x-1", "1000", "4900000000001"),
      },
    };
    expect(parseRakutenItem(json).selling_price).toBe(5000);
  });
});
