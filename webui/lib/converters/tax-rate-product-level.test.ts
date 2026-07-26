import { describe, it, expect } from "vitest";
import { makeProduct, VariantSchema, type Variant } from "../product/schema";
import { NEConverter } from "./ne";
import { YahooConverter } from "./yahoo";
import { ShopifyConverter } from "./shopify";
import { yahooItemsForProduct } from "../product/yahoo-split";
import { buildYahooVariationParams } from "../yahoo/variation-params";

/** 税率は商品レベル(p.tax_rate)が正（260715修正）。
 * 楽天仕様でも税率は payment.taxRate（商品レベル）のみで、「モール取込」が更新するのも
 * 商品レベルの税率。variant.tax_rate は古い値(既定10)のまま残ることがあるため、
 * 変換・出力では商品レベルを使う（RakutenPreview と同じ設計判断）。
 * 再現データ: r7201-1（商品=8%・variants=10%のまま・税抜3,912）。 */

const mkVar = (over: Record<string, unknown> = {}): Variant =>
  VariantSchema.parse({
    sku_manage_number: "r7201-1-mg",
    ne_code: "r7201-1-mg",
    jan_code: "4589837520616",
    selling_price: 3912,
    tax_rate: 10, // ← 古いまま残った variant 税率
    quantity: 1,
    shipping_type: "送料無料",
    variation_value: "マンゴー味",
    ...over,
  });

const staleProduct = () =>
  makeProduct({
    tax_rate: 8, // ← 正（商品レベル）
    variants: [
      mkVar(),
      mkVar({ sku_manage_number: "r7201-1-sw", ne_code: "r7201-1-sw", jan_code: "4589837520890", variation_value: "シークヮーサー味", quantity: 2, selling_price: 7517 }),
    ],
  });

describe("NEConverter — SKU行の税率は商品レベルを使う", () => {
  it("tax_rate 列と free4(税込価格) が商品税率 8% で出力される", () => {
    const { singles } = new NEConverter().convert([staleProduct()]);
    const row = singles.find((r) => r.syohin_code === "r7201-1-mg");
    expect(row?.tax_rate).toBe("8");
    expect(row?.free4).toBe(String(Math.floor(3912 * 1.08))); // 4224
  });

  it("セット行も商品税率で出力される", () => {
    const { sets } = new NEConverter().convert([staleProduct()]);
    const row = sets.find((r) => r.set_syohin_code === "r7201-1-sw");
    expect(row?.tax_rate).toBe("8");
    expect(row?.free4).toBe(String(Math.floor(7517 * 1.08))); // 8118
  });
});

describe("yahooItemsForProduct — SKU展開時の税率は商品レベルを引き継ぐ", () => {
  it("展開された擬似商品の tax_rate が 8 になる", () => {
    const items = yahooItemsForProduct(staleProduct());
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.tax_rate === 8)).toBe(true);
  });
});

describe("YahooConverter — 多SKU代表行の税込変換は商品税率を使う", () => {
  it("price / original-price / taxrate-type が 8% で出力される", () => {
    const row = new YahooConverter().convert([staleProduct()])[0];
    expect(row["price"]).toBe(String(Math.floor((3912 * 108) / 100))); // 4224 (切り捨て・2026-07-24裁定)
    expect(row["taxrate-type"]).toBe("0.08");
  });
});

describe("buildYahooVariationParams — subcode_param の税込価格は商品税率を使う", () => {
  it("SKU別価格が 8% 変換で出力される", () => {
    const p = makeProduct({
      tax_rate: 8,
      yahoo_variation_mode: "unified",
      yahoo_variation_title: "タイプ",
      variants: [mkVar(), mkVar({ sku_manage_number: "r7201-1-sw", ne_code: "r7201-1-sw", variation_value: "シークヮーサー味", selling_price: 7517 })],
    });
    const r = buildYahooVariationParams(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.subcode_param).toContain(`r7201-1-mg=price:${Math.floor((3912 * 108) / 100)}`); // 4224 (切り捨て)
      expect(r.params.subcode_param).toContain(`r7201-1-sw=price:${Math.floor(7517 * 1.08 + 0.5)}`); // 8118
    }
  });
});

describe("ShopifyConverter — Variant Price の税込変換は商品税率を使う", () => {
  it("Variant Price が 8% で出力される", () => {
    const rows = new ShopifyConverter().convert([staleProduct()]);
    const skuRow = rows.find((r) => r["Variant SKU"] === "r7201-1-mg");
    expect(skuRow?.["Variant Price"]).toBe(String(Math.round(3912 * 1.08))); // 4225
  });
});
