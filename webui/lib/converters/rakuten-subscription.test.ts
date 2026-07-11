import { describe, it, expect } from "vitest";
import { parseRakutenItem, parseRakutenVariants } from "./rakuten-item-parser";
import { buildRakutenUpsertBody, validateSubscription } from "./rakuten-api";
import { buildRakutenPatchBody, diffVariants } from "./rakuten-patch";
import { makeProduct } from "../product/schema";
import type { ChangedField } from "../product/diff";

/** 楽天 定期購入（260711修正依頼-5）の取込→編集→反映テスト。
 * 期待値は資料 rakuten-subscription-product-registration.md の仕様:
 * 定期専用 itemType は無く、subscription{shippingDateFlag,shippingIntervalFlag} +
 * features.displaySubscriptionCartButton + variant.subscriptionPrice{basePrice,individualPrices.firstPrice}
 * で表現。有効時は日付/間隔の少なくとも一方（IE0179）、定期価格は通常価格から5%以上割引（IE0430）。 */

/** 定期購入設定済みの items.get レスポンス相当。 */
function subscriptionJson(): Record<string, unknown> {
  return {
    title: "定期テスト商品",
    features: { displaySubscriptionCartButton: true },
    subscription: { shippingDateFlag: true, shippingIntervalFlag: false },
    payment: { taxIncluded: true, taxRate: "0.1" },
    variants: {
      "r1-0001-1": {
        merchantDefinedSkuId: "r1-0001-1",
        standardPrice: "3000",
        articleNumber: { value: "4900000000001" },
        shipping: { postageIncluded: true },
        subscriptionPrice: { basePrice: "2700", individualPrices: { firstPrice: "2500" } },
      },
    },
  };
}

describe("parseRakutenItem — 定期購入の取込（criteria E2: 取込パース）", () => {
  it("features/subscription/variant.subscriptionPrice を取り込む", () => {
    const out = parseRakutenItem(subscriptionJson());
    expect(out.subscription_enabled).toBe(true);
    expect(out.subscription_shipping_date_flag).toBe(true);
    expect(out.subscription_interval_flag).toBe(false);
    expect(out.subscription_base_price).toBe(2700);
    expect(out.subscription_first_price).toBe(2500);
  });
  it("定期購入なしの商品は false / 0 で埋める（差分検出が「新規設定」を検知できる形）", () => {
    const out = parseRakutenItem({
      title: "通常商品",
      variants: { "r1-0001-1": { merchantDefinedSkuId: "r1-0001-1", standardPrice: "3000" } },
    });
    expect(out.subscription_enabled).toBe(false);
    expect(out.subscription_shipping_date_flag).toBe(false);
    expect(out.subscription_interval_flag).toBe(false);
    expect(out.subscription_base_price).toBe(0);
    expect(out.subscription_first_price).toBe(0);
  });
  it("parseRakutenVariants も SKU ごとの定期価格を取り込む", () => {
    const vs = parseRakutenVariants(subscriptionJson());
    expect(vs[0].subscription_base_price).toBe(2700);
    expect(vs[0].subscription_first_price).toBe(2500);
  });
});

describe("buildRakutenUpsertBody — 定期購入の送信（登録経路）", () => {
  it("有効時は subscription + 両カートボタン true（定期ボタンには通常ボタンも必須 IE0432）", () => {
    const p = makeProduct({
      subscription_enabled: true,
      subscription_shipping_date_flag: true,
      subscription_base_price: 9000, // 通常10000の5%以上割引（IE0430 を満たす値）
    });
    const body = buildRakutenUpsertBody(p);
    expect(body.subscription).toEqual({ shippingDateFlag: true, shippingIntervalFlag: false });
    const features = body.features as Record<string, unknown>;
    expect(features.displayNormalCartButton).toBe(true);
    expect(features.displaySubscriptionCartButton).toBe(true);
    const variants = body.variants as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["t002-2542-1"].subscriptionPrice).toEqual({ basePrice: "9000" });
  });
  it("初回価格ありは individualPrices.firstPrice を同梱する", () => {
    const p = makeProduct({
      subscription_enabled: true,
      subscription_shipping_date_flag: true,
      subscription_base_price: 9000,
      subscription_first_price: 8500,
    });
    const variants = buildRakutenUpsertBody(p).variants as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["t002-2542-1"].subscriptionPrice).toEqual({
      basePrice: "9000",
      individualPrices: { firstPrice: "8500" },
    });
  });
  it("無効（既定）なら subscription も subscriptionPrice も送らない", () => {
    const body = buildRakutenUpsertBody(makeProduct({ subscription_base_price: 9000 }));
    expect(body.subscription).toBeUndefined();
    const variants = body.variants as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["t002-2542-1"].subscriptionPrice).toBeUndefined();
  });
});

describe("buildRakutenPatchBody — 定期購入の反映（criteria E2: patch 生成）", () => {
  it("有効化: subscription + 両カートボタン true を送る", () => {
    const p = makeProduct({
      subscription_enabled: true,
      subscription_shipping_date_flag: true,
      subscription_interval_flag: false,
    });
    const changed: ChangedField[] = [{ field: "subscription_enabled", before: false, after: true }];
    const { body } = buildRakutenPatchBody(changed, p);
    expect(body.subscription).toEqual({ shippingDateFlag: true, shippingIntervalFlag: false });
    expect(body.features).toEqual({ displayNormalCartButton: true, displaySubscriptionCartButton: true });
  });
  it("無効化: displaySubscriptionCartButton=false のみ送る（公式の停止方法）", () => {
    const p = makeProduct({ subscription_enabled: false });
    const changed: ChangedField[] = [{ field: "subscription_enabled", before: true, after: false }];
    const { body } = buildRakutenPatchBody(changed, p);
    expect(body.features).toEqual({ displaySubscriptionCartButton: false });
    expect(body.subscription).toBeUndefined();
  });
  it("フラット商品の定期価格変更は variants.{key}.subscriptionPrice を送る", () => {
    const p = makeProduct({ subscription_enabled: true, subscription_base_price: 9000 });
    const changed: ChangedField[] = [{ field: "subscription_base_price", before: 0, after: 9000 }];
    const { body } = buildRakutenPatchBody(changed, p);
    const variants = body.variants as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["t002-2542-1"].subscriptionPrice).toEqual({ basePrice: "9000" });
  });
  it("多SKU: snapshot と異なるSKUだけ subscriptionPrice を patch する", () => {
    const mk = (base: number) =>
      makeProduct({
        variants: [
          { sku_manage_number: "sku-a", ne_code: "a-1", jan_code: "4900000000001", selling_price: 3000, tax_rate: 10, quantity: 1, variation_value: "1本", subscription_base_price: base },
          { sku_manage_number: "sku-b", ne_code: "a-2", jan_code: "4900000000002", selling_price: 6000, tax_rate: 10, quantity: 2, variation_value: "2本", subscription_base_price: 5700 },
        ],
      });
    const snapshot = mk(0);
    const edited = mk(2850);
    const { body } = buildRakutenPatchBody([], edited, { variants: snapshot.variants });
    const variants = body.variants as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["sku-a"].subscriptionPrice).toEqual({ basePrice: "2850" });
    expect(variants["sku-b"]).toBeUndefined(); // 変更なしSKUは送らない（最小patch）
  });
  it("diffVariants が SKU別の定期価格変更を検出する（反映プレビュー用）", () => {
    const mk = (base: number, first: number) =>
      makeProduct({
        variants: [
          { sku_manage_number: "sku-a", ne_code: "a-1", jan_code: "4900000000001", selling_price: 3000, tax_rate: 10, quantity: 1, variation_value: "1本", subscription_base_price: base, subscription_first_price: first },
        ],
      });
    const d = diffVariants(mk(0, 0).variants, mk(2850, 2700).variants);
    expect(d.some((c) => c.field === "SKU[sku-a].定期価格" && c.after === "2850/2700")).toBe(true);
  });
});

describe("validateSubscription — 事前検証（IE0179/IE0430/IE0431/IE0433/IE0434）", () => {
  it("無効なら常に OK（定期設定は検証対象外）", () => {
    expect(validateSubscription(makeProduct()).ok).toBe(true);
  });
  it("日付指定・間隔指定の両方 false → IE0179", () => {
    const r = validateSubscription(makeProduct({ subscription_enabled: true, subscription_base_price: 9000 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("IE0179"))).toBe(true);
  });
  it("どのSKUにも定期価格なし → IE0433", () => {
    const r = validateSubscription(makeProduct({ subscription_enabled: true, subscription_shipping_date_flag: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("IE0433"))).toBe(true);
  });
  it("初回価格だけ（定期価格なし）→ IE0434", () => {
    const r = validateSubscription(
      makeProduct({ subscription_enabled: true, subscription_shipping_date_flag: true, subscription_first_price: 8000 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("IE0434"))).toBe(true);
  });
  it("5%以上割引の境界: 通常10000円 → 9500円は OK・9501円はエラー（IE0430）", () => {
    const ok = validateSubscription(
      makeProduct({ subscription_enabled: true, subscription_shipping_date_flag: true, subscription_base_price: 9500 }),
    );
    expect(ok.ok).toBe(true);
    const ng = validateSubscription(
      makeProduct({ subscription_enabled: true, subscription_shipping_date_flag: true, subscription_base_price: 9501 }),
    );
    expect(ng.ok).toBe(false);
    if (!ng.ok) expect(ng.errors.some((e) => e.includes("5%以上"))).toBe(true);
  });
});
