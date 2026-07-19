/** SKU在庫数（stock_quantity）のスキーマ・合成のテスト（仕様変更 260720）。 */
import { describe, it, expect } from "vitest";
import { makeProduct, productVariants, isEmptyVariant, VariantSchema } from "./schema";

describe("stock_quantity", () => {
  it("SKU の在庫数は variants[].stock_quantity に保持される", () => {
    const v = VariantSchema.parse({ ne_code: "a-1", stock_quantity: 5 });
    expect(v.stock_quantity).toBe(5);
  });

  it("未入力（キーなし）は undefined のまま（0 と区別する）", () => {
    const v = VariantSchema.parse({ ne_code: "a-1" });
    expect(v.stock_quantity).toBe(undefined);
  });

  it("フラット商品の在庫数は productVariants の合成SKUへ引き継がれる", () => {
    const p = makeProduct({ ne_code: "a-1", stock_quantity: 7, variants: [] });
    expect(productVariants(p)[0].stock_quantity).toBe(7);
  });

  it("在庫数だけ入力された variant 行は実質空ではない（保存時に消さない）", () => {
    expect(isEmptyVariant(VariantSchema.parse({ stock_quantity: 5 }))).toBe(false);
  });
});
