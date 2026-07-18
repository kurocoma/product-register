import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody } from "./rakuten-api";

type Variants = Record<string, Record<string, unknown>>;
const variantsOf = (p: Parameters<typeof buildRakutenUpsertBody>[0]) =>
  buildRakutenUpsertBody(p).variants as Variants;

describe("buildRakutenUpsertBody 属性フォールバック(IE0418対策)", () => {
  it("多SKU: variantの属性が空なら商品共通の属性へフォールバックする", () => {
    const p = makeProduct({
      attributes: [
        { item: "ブランド名", value: "シークヮーサープレミアム", unit: "", requirement: "必須" },
        { item: "総入数", value: "3", unit: "本", requirement: "必須" },
      ],
      variants: [
        {
          sku_manage_number: "a1",
          ne_code: "a1",
          jan_code: "4571464240265",
          selling_price: 1000,
          tax_rate: 10,
          quantity: 1,
          shipping_type: "送料無料",
          attributes: [],
        },
      ],
    });
    // 空だった variant の attributes に商品共通の属性(ブランド名・総入数)が乗ること
    expect(variantsOf(p)["a1"].attributes).toEqual([
      { name: "ブランド名", values: ["シークヮーサープレミアム"] },
      { name: "総入数", values: ["3"], unit: "本" },
    ]);
  });

  it("多SKU: variant固有の属性があるときはそれを優先し、商品共通で上書きしない", () => {
    const p = makeProduct({
      attributes: [{ item: "総入数", value: "3", unit: "本", requirement: "必須" }],
      variants: [
        {
          sku_manage_number: "a2",
          ne_code: "a2",
          jan_code: "4571464240272",
          selling_price: 2000,
          tax_rate: 10,
          quantity: 2,
          shipping_type: "送料無料",
          attributes: [{ item: "総入数", value: "6", unit: "本", requirement: "必須" }],
        },
      ],
    });
    // variant固有(6本)が使われ、商品共通(3本)へフォールバックしないこと
    expect(variantsOf(p)["a2"].attributes).toEqual([
      { name: "総入数", values: ["6"], unit: "本" },
    ]);
  });

  it("多SKU: 各variantが独立に、空のものだけ商品共通へフォールバックする", () => {
    const p = makeProduct({
      attributes: [
        { item: "ブランド名", value: "共通ブランド", unit: "", requirement: "必須" },
        { item: "総入数", value: "3", unit: "本", requirement: "必須" },
      ],
      variants: [
        {
          sku_manage_number: "a1",
          ne_code: "a1",
          jan_code: "4571464240265",
          selling_price: 1000,
          tax_rate: 10,
          quantity: 1,
          shipping_type: "送料無料",
          attributes: [],
        },
        {
          sku_manage_number: "a2",
          ne_code: "a2",
          jan_code: "4571464240272",
          selling_price: 2000,
          tax_rate: 10,
          quantity: 2,
          shipping_type: "送料無料",
          attributes: [
            { item: "ブランド名", value: "共通ブランド", unit: "", requirement: "必須" },
            { item: "総入数", value: "6", unit: "本", requirement: "必須" },
          ],
        },
      ],
    });
    const vs = variantsOf(p);
    expect(vs["a1"].attributes).toEqual([
      { name: "ブランド名", values: ["共通ブランド"] },
      { name: "総入数", values: ["3"], unit: "本" },
    ]);
    expect(vs["a2"].attributes).toEqual([
      { name: "ブランド名", values: ["共通ブランド"] },
      { name: "総入数", values: ["6"], unit: "本" },
    ]);
  });

  it("多SKU: variantも商品共通も属性が無ければ attributes キーを付けない(空配列を送らない)", () => {
    const p = makeProduct({
      attributes: [],
      variants: [
        {
          sku_manage_number: "a1",
          ne_code: "a1",
          jan_code: "4571464240265",
          selling_price: 1000,
          tax_rate: 10,
          quantity: 1,
          shipping_type: "送料無料",
          attributes: [],
        },
      ],
    });
    expect(variantsOf(p)["a1"].attributes).toBeUndefined();
  });

  it("単品(variants未設定): 商品共通属性がSKUに乗る(従来互換)", () => {
    const p = makeProduct({
      ne_code: "t002-2542-1",
      attributes: [{ item: "ブランド名", value: "巨人", unit: "", requirement: "必須" }],
    });
    expect(variantsOf(p)["t002-2542-1"].attributes).toEqual([
      { name: "ブランド名", values: ["巨人"] },
    ]);
  });
});
