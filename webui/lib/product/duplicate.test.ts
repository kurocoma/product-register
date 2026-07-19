/** 商品複製（アウトレット品作成用・260720機能追加）のテスト。
 * 仕様: 識別子（NEコード・楽天管理番号）だけ変更し、残りの項目はそのままコピー。
 * ただし原本のモール商品を誤って上書きしないよう、モール連携キー
 * （mall_listed / shopify_product_id / rakuten_variant_id）は必ずリセットする。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "./schema";
import { duplicateProductInput } from "./duplicate";

const original = () =>
  makeProduct({
    ne_code: "a028-3593-1",
    jan_code: "4909388103593",
    product_name: "ぴゅあなアセロラ 500ml",
    selling_price: 1800,
    rakuten_manage_number: "acero1a7",
    rakuten_variant_id: "a028-3593-1",
    shopify_product_id: "gid://shopify/Product/123",
    mall_listed: { rakuten: true, yahoo: true },
    variants: [
      { ne_code: "a028-3593-1", sku_manage_number: "a028-3593-1", selling_price: 1800, tax_rate: 8, quantity: 1, shipping_type: "送料無料", variation_value: "1本" },
    ],
  });

describe("duplicateProductInput", () => {
  it("NEコードを差し替え、商品内容（名前・価格・JAN・variants等）はそのままコピーする", () => {
    const dup = duplicateProductInput(original(), { ne_code: "a028-3593-1-ol" });
    expect(dup.ne_code).toBe("a028-3593-1-ol");
    expect(dup.product_name).toBe("ぴゅあなアセロラ 500ml");
    expect(dup.jan_code).toBe("4909388103593");
    expect(dup.selling_price).toBe(1800);
    expect(dup.variants).toEqual(original().variants); // SKUはそのまま（複製後にSKU一覧で編集）
  });

  it("楽天管理番号は指定値を使い、未指定なら空（未設定）にする", () => {
    expect(
      duplicateProductInput(original(), { ne_code: "x-1", rakuten_manage_number: "acero-ol" })
        .rakuten_manage_number,
    ).toBe("acero-ol");
    expect(duplicateProductInput(original(), { ne_code: "x-1" }).rakuten_manage_number).toBe("");
  });

  it("モール連携キーをリセットする（原本のモール商品を誤上書きしないため）", () => {
    const dup = duplicateProductInput(original(), { ne_code: "x-1" });
    expect(dup.mall_listed).toEqual({});
    expect(dup.shopify_product_id).toBe("");
    expect(dup.rakuten_variant_id).toBe("");
  });

  it("NEコードは trim され、空なら例外（保存必須条件を満たさない複製を作らない）", () => {
    expect(duplicateProductInput(original(), { ne_code: "  x-1  " }).ne_code).toBe("x-1");
    expect(() => duplicateProductInput(original(), { ne_code: "  " })).toThrow();
  });

  it("元の商品と同じNEコードは例外（重複複製の防止）", () => {
    expect(() => duplicateProductInput(original(), { ne_code: "a028-3593-1" })).toThrow();
  });
});
