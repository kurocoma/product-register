/** IE0416（Cannot update selectorValues for the same variantId）自動補正のテスト。
 * - buildRakutenUpsertBody: 軸キーは取込時に保存した variation_key を優先（無ければ従来 "type"）
 * - alignSelectorsWithExisting: 既存商品の軸キー・選択肢値を正として upsert body を揃える */
import { describe, expect, it } from "vitest";

import { makeProduct } from "../product/schema";
import { alignSelectorsWithExisting, buildRakutenUpsertBody } from "./rakuten-api";

type Selector = { key: string; displayName?: string; values: { displayValue: string }[] };
type Variants = Record<string, Record<string, unknown>>;
const selectorOf = (b: Record<string, unknown>) => (b.variantSelectors as Selector[])[0];
const variantsOf = (b: Record<string, unknown>) => b.variants as Variants;

const twoVariants = [
  { sku_manage_number: "sku-a", ne_code: "n001-0001-1", jan_code: "4900000000011", selling_price: 1000, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", variation_value: "500ml" },
  { sku_manage_number: "sku-b", ne_code: "n001-0001-2", jan_code: "4900000000028", selling_price: 1800, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", variation_value: "720ml" },
];

describe("buildRakutenUpsertBody 軸キー（IE0416対策）", () => {
  it("variation_key / variation_name があれば軸キー・軸名に使う（取込→反映の往復対称）", () => {
    const body = buildRakutenUpsertBody(
      makeProduct({ variants: twoVariants, variation_key: "select1", variation_name: "容量" }),
    );
    expect(selectorOf(body).key).toBe("select1");
    expect(selectorOf(body).displayName).toBe("容量");
    expect(variantsOf(body)["sku-a"].selectorValues).toEqual({ select1: "500ml" });
    expect(variantsOf(body)["sku-b"].selectorValues).toEqual({ select1: "720ml" });
  });

  it("variation_key 未設定は従来どおり type（後方互換）", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    expect(selectorOf(body).key).toBe("type");
    expect(variantsOf(body)["sku-a"].selectorValues).toEqual({ type: "500ml" });
  });

  it("variation_name 未設定は yahoo_variation_title にフォールバック", () => {
    const body = buildRakutenUpsertBody(
      makeProduct({ variants: twoVariants, yahoo_variation_title: "サイズ" }),
    );
    expect(selectorOf(body).displayName).toBe("サイズ");
  });
});

describe("alignSelectorsWithExisting（IE0416 自動補正）", () => {
  const existing = {
    variantSelectors: [
      { key: "select1", displayName: "容量（既存）", values: [{ displayValue: "五百" }, { displayValue: "七二〇" }] },
    ],
    variants: {
      "sku-a": { selectorValues: { select1: "五百" } },
      "sku-b": { selectorValues: { select1: "七二〇" } },
    },
  };

  it("軸キーの相違を既存に揃え、既存 variantId は既存の選択肢値をそのまま送る", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    const out = alignSelectorsWithExisting(body, existing);
    expect(selectorOf(out).key).toBe("select1");
    expect(variantsOf(out)["sku-a"].selectorValues).toEqual({ select1: "五百" });
    expect(variantsOf(out)["sku-b"].selectorValues).toEqual({ select1: "七二〇" });
    expect(selectorOf(out).values).toEqual([{ displayValue: "五百" }, { displayValue: "七二〇" }]);
  });

  it("displayName は body 側の値を維持する（軸名は変更可のため）", () => {
    const body = buildRakutenUpsertBody(
      makeProduct({ variants: twoVariants, variation_name: "容量（編集後）" }),
    );
    const out = alignSelectorsWithExisting(body, existing);
    expect(selectorOf(out).displayName).toBe("容量（編集後）");
  });

  it("新規 variantId は body 側の値を維持し、既存値と重複したら連番付与", () => {
    const three = [
      ...twoVariants,
      { sku_manage_number: "sku-c", ne_code: "n001-0001-3", jan_code: "4900000000035", selling_price: 2500, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", variation_value: "五百" },
    ];
    const body = buildRakutenUpsertBody(makeProduct({ variants: three }));
    const out = alignSelectorsWithExisting(body, existing);
    expect(variantsOf(out)["sku-c"].selectorValues).toEqual({ select1: "五百(2)" });
    expect(selectorOf(out).values).toEqual([
      { displayValue: "五百" },
      { displayValue: "七二〇" },
      { displayValue: "五百(2)" },
    ]);
  });

  it("既存側に軸が無い・existingJson が無い・単品 body はそのまま返す", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    expect(alignSelectorsWithExisting(body, null)).toBe(body);
    expect(alignSelectorsWithExisting(body, {})).toBe(body);
    const single = buildRakutenUpsertBody(makeProduct());
    expect(alignSelectorsWithExisting(single, existing)).toBe(single);
  });

  it("入力 body を破壊しない（元の軸キー・選択肢値は変わらない）", () => {
    const body = buildRakutenUpsertBody(makeProduct({ variants: twoVariants }));
    alignSelectorsWithExisting(body, existing);
    expect(selectorOf(body).key).toBe("type");
    expect(variantsOf(body)["sku-a"].selectorValues).toEqual({ type: "500ml" });
  });
});
