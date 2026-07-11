import { describe, it, expect } from "vitest";
import { buildRakutenPatchBody } from "./rakuten-patch";
import { makeProduct } from "../product/schema";
import type { ChangedField } from "../product/diff";

// 定期価格を 0 へ解除する編集は patch で表現できない（subscriptionPrice の null 削除仕様が
// 資料 §8 で未確認のため安全側で未送信）。従来は diffVariants が「変更あり」と出すのに
// 送信も skipped 表示もされず、プレビューと実挙動が食い違っていた。
// → 解除ケースを skipped に載せて「未反映」を運用者に明示する。
describe("buildRakutenPatchBody — 定期価格の0円解除は skipped で未反映を明示", () => {
  const mkVariants = (base: number) =>
    makeProduct({
      variants: [
        { sku_manage_number: "sku-a", ne_code: "a-1", jan_code: "4900000000001", selling_price: 3000, tax_rate: 10, quantity: 1, variation_value: "1本", subscription_base_price: base },
      ],
    });

  it("多SKU: >0→0 の解除は subscriptionPrice を送らず skipped に載る", () => {
    const { body, skipped } = buildRakutenPatchBody([], mkVariants(0), { variants: mkVariants(2850).variants });
    const variants = (body.variants ?? {}) as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["sku-a"]?.subscriptionPrice).toBeUndefined();
    expect(skipped.some((s) => s.includes("SKU[sku-a].定期価格") && s.includes("解除"))).toBe(true);
  });

  it("多SKU: 0→>0 の設定は従来どおり送信され skipped に載らない", () => {
    const { body, skipped } = buildRakutenPatchBody([], mkVariants(2850), { variants: mkVariants(0).variants });
    const variants = body.variants as Record<string, { subscriptionPrice?: unknown }>;
    expect(variants["sku-a"].subscriptionPrice).toEqual({ basePrice: "2850" });
    expect(skipped.some((s) => s.includes("定期価格"))).toBe(false);
  });

  it("単品: 定期有効のまま価格だけ 0 へ解除すると skipped に載る", () => {
    const p = makeProduct({ subscription_enabled: true, subscription_base_price: 0 });
    const changed: ChangedField[] = [{ field: "subscription_base_price", before: 9000, after: 0 }];
    const { body, skipped } = buildRakutenPatchBody(changed, p);
    expect(body.variants).toBeUndefined();
    expect(skipped.some((s) => s.includes("定期価格") && s.includes("解除"))).toBe(true);
  });

  it("単品: 定期無効化と同時の価格0は公式の停止フロー（features=false）なので skipped に載せない", () => {
    const p = makeProduct({ subscription_enabled: false, subscription_base_price: 0 });
    const changed: ChangedField[] = [
      { field: "subscription_enabled", before: true, after: false },
      { field: "subscription_base_price", before: 9000, after: 0 },
    ];
    const { body, skipped } = buildRakutenPatchBody(changed, p);
    expect(body.features).toEqual({ displaySubscriptionCartButton: false });
    expect(skipped.some((s) => s.includes("定期価格"))).toBe(false);
  });
});
