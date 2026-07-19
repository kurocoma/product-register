/** 保存時のゴーストSKU除去のテスト。
 * 「+ SKU追加」の空行が DB (extra.variants) に保存されないことを保証する
 * （空行が残ると多SKU扱いになり定期購入 IE0433 等の事故が起きる。r0101-1 実件）。 */
import { describe, expect, it } from "vitest";
import { makeProduct, VariantSchema } from "./schema";
import { productInputToDbRow } from "./repository";

const ghostRow = () => VariantSchema.parse({});
const realRow = () => VariantSchema.parse({ ne_code: "r74-1", selling_price: 100 });

describe("productInputToDbRow: variants の空行除去", () => {
  it("空行は保存されず、実内容のある行だけ extra.variants に入る", () => {
    const row = productInputToDbRow(makeProduct({ variants: [ghostRow(), realRow()] }));
    const extra = row.extra as { variants: unknown[] };
    expect(extra.variants).toEqual([realRow()]);
  });

  it("全部空行なら extra.variants は空配列（フラット扱いに戻る）", () => {
    const row = productInputToDbRow(makeProduct({ variants: [ghostRow()] }));
    const extra = row.extra as { variants: unknown[] };
    expect(extra.variants).toEqual([]);
  });
});
