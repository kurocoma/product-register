/** alignSelectorKeyWithExisting（軸キーのみ既存に揃える楽観ボディ）のテスト（260720:
 * ラベル（選択肢名）の変更をまずそのまま送り、IE0416 時だけ現状値へフォールバックする方式）。 */
import { describe, expect, it } from "vitest";

import { makeProduct } from "../product/schema";
import { alignSelectorKeyWithExisting, buildRakutenUpsertBody } from "./rakuten-api";

type Selector = { key: string; displayName?: string; values: { displayValue: string }[] };
type Variants = Record<string, Record<string, unknown>>;
const selectorOf = (b: Record<string, unknown>) => (b.variantSelectors as Selector[])[0];
const variantsOf = (b: Record<string, unknown>) => b.variants as Variants;

const twoVariants = [
  { sku_manage_number: "sku-a", ne_code: "n001-0001-1", jan_code: "4900000000011", selling_price: 1000, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", variation_value: "1袋" },
  { sku_manage_number: "sku-b", ne_code: "n001-0001-2", jan_code: "4900000000028", selling_price: 1800, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", variation_value: "3袋" },
];

const existing = {
  variantSelectors: [{ key: "select1", displayName: "既存軸", values: [{ displayValue: "1本" }, { displayValue: "1本(2)" }] }],
  variants: {
    "sku-a": { selectorValues: { select1: "1本" } },
    "sku-b": { selectorValues: { select1: "1本(2)" } },
  },
};

describe("alignSelectorKeyWithExisting", () => {
  it("軸キーは既存に揃え、選択肢名はアプリの編集値を維持する（楽観ボディ）", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    const out = alignSelectorKeyWithExisting(body, existing);
    expect(selectorOf(out).key).toBe("select1");
    expect(variantsOf(out)["sku-a"].selectorValues).toEqual({ select1: "1袋" });
    expect(variantsOf(out)["sku-b"].selectorValues).toEqual({ select1: "3袋" });
    // 選択肢定義（values）も body 側のラベルのまま
    expect(selectorOf(out).values).toEqual([{ displayValue: "1袋" }, { displayValue: "3袋" }]);
  });

  it("既存側に軸が無い・existingJson が無い・単品 body はそのまま返す", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    expect(alignSelectorKeyWithExisting(body, null)).toBe(body);
    expect(alignSelectorKeyWithExisting(body, {})).toBe(body);
    const single = buildRakutenUpsertBody(makeProduct());
    expect(alignSelectorKeyWithExisting(single, existing)).toBe(single);
  });

  it("入力 body を破壊しない", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    alignSelectorKeyWithExisting(body, existing);
    expect(selectorOf(body).key).toBe("type");
    expect(variantsOf(body)["sku-a"].selectorValues).toEqual({ type: "1袋" });
  });
});
