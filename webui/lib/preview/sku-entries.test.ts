import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { buildSkuEntries, buildRepresentativeEntries } from "./sku-entries";

/** 多SKUページ商品（variants 2件）。 */
function makeMultiSku() {
  return makeProduct({
    ne_code: "kmzt.i-0001-1",
    variants: [
      {
        sku_manage_number: "sku-a",
        ne_code: "kmzt.i-0001-1",
        jan_code: "4955028002542",
        selling_price: 1000,
        quantity: 1,
        variation_value: "1本",
        shipping_type: "送料別",
      },
      {
        sku_manage_number: "sku-b",
        ne_code: "kmzt.i-0001-s01",
        jan_code: "4955028002559",
        selling_price: 2800,
        quantity: 3,
        variation_value: "3本セット",
        shipping_type: "送料無料",
      },
    ],
  });
}

describe("buildSkuEntries (プレビューの SKU 切替リスト)", () => {
  it("フラット商品 + peers → 商品ごとに1エントリ・quantity 昇順（従来のpeers挙動と同等）", () => {
    const product = makeProduct({ ne_code: "t002-2542-1", quantity: 1, selling_price: 10000 });
    const peer = makeProduct({
      ne_code: "t002-2542-3",
      quantity: 3,
      selling_price: 28000,
      product_type: "セット商品",
    });
    const entries = buildSkuEntries(product, [peer]);
    expect(entries).toHaveLength(2);
    expect(entries[0].v.ne_code).toBe("t002-2542-1");
    expect(entries[1].v.ne_code).toBe("t002-2542-3");
    expect(entries[1].v.selling_price).toBe(28000);
    // page フィールドは各エントリの元 product を指す
    expect(entries[1].p.ne_code).toBe("t002-2542-3");
  });

  it("多SKU商品 → variants[] を展開し page フィールドは同一 product を共有", () => {
    const product = makeMultiSku();
    const entries = buildSkuEntries(product, []);
    expect(entries).toHaveLength(2);
    expect(entries[0].v.ne_code).toBe("kmzt.i-0001-1");
    expect(entries[1].v.ne_code).toBe("kmzt.i-0001-s01");
    expect(entries[0].p).toBe(product);
    expect(entries[1].p).toBe(product);
  });

  it("product 自身と同じ ne_code の peer は除外する（従来挙動）", () => {
    const product = makeProduct({ ne_code: "t002-2542-1" });
    const dup = makeProduct({ ne_code: "t002-2542-1" });
    const entries = buildSkuEntries(product, [dup]);
    expect(entries).toHaveLength(1);
  });

  it("variant の ne_code 単位でも重複排除する（product 側優先）", () => {
    const product = makeMultiSku(); // variants: ...-1, ...-s01
    const peer = makeProduct({ ne_code: "kmzt.i-0001-s01", selling_price: 9999 });
    const entries = buildSkuEntries(product, [peer]);
    expect(entries).toHaveLength(2);
    const s01 = entries.find((e) => e.v.ne_code === "kmzt.i-0001-s01")!;
    expect(s01.v.selling_price).toBe(2800); // product の variant が勝つ
  });

  it("peerFilter で peers を絞り込める", () => {
    const product = makeProduct({ ne_code: "a-0001-1", maker_code: "a001" });
    const sameBase = makeProduct({ ne_code: "a-0001-3", quantity: 3 });
    const otherBase = makeProduct({
      ne_code: "b-0002-1",
      maker_code: "b002",
      jan_code: "4900000000002",
    });
    const entries = buildSkuEntries(product, [sameBase, otherBase], {
      peerFilter: (p) => p.maker_code === product.maker_code,
    });
    expect(entries.map((e) => e.v.ne_code)).not.toContain("b-0002-1");
  });
});

describe("buildRepresentativeEntries (Yahoo: 商品ごとに variants[0] 代表)", () => {
  it("多SKU商品でも商品ごとに1エントリ（variants[0]）だけ返す", () => {
    const product = makeMultiSku();
    const peer = makeProduct({ ne_code: "t002-2542-3", quantity: 3 });
    const entries = buildRepresentativeEntries(product, [peer]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.v.ne_code)).toEqual(["kmzt.i-0001-1", "t002-2542-3"]);
  });
});
