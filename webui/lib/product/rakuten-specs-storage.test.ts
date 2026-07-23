import { describe, expect, it } from "vitest";
import { dbRowToProductInput, productInputToDbRow, type ProductRow } from "./repository";
import { isEmptyVariant, makeProduct, VariantSchema } from "./schema";

describe("VariantSchema 楽天SKU自由入力行", () => {
  it("最大5行・label 40文字・value 140文字を受け入れ、extra JSONBで往復する", () => {
    const specs = Array.from({ length: 5 }, (_, i) => ({
      label: `${i + 1}`.repeat(40),
      value: `${i + 1}`.repeat(140),
    }));
    const variant = VariantSchema.parse({
      sku_manage_number: "sku-specs",
      ne_code: "sku-specs",
      selling_price: 1000,
      specs,
    });
    const product = makeProduct({ variants: [variant] });

    const db = productInputToDbRow(product);
    expect((db.extra as { variants: unknown[] }).variants).toEqual([variant]);

    const restored = dbRowToProductInput({
      ...db,
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      created_at: "2026-07-21T00:00:00.000Z",
      updated_at: "2026-07-21T00:00:00.000Z",
    } as ProductRow);
    expect(restored.variants[0].specs).toEqual(specs);
  });

  it("行数・文字数・必須項目・未知キーを厳格に拒否する", () => {
    expect(
      VariantSchema.safeParse({ specs: Array.from({ length: 6 }, () => ({ label: "項目", value: "値" })) }).success,
    ).toBe(false);
    expect(VariantSchema.safeParse({ specs: [{ label: "項".repeat(41), value: "値" }] }).success).toBe(false);
    expect(VariantSchema.safeParse({ specs: [{ label: "項目", value: "値".repeat(141) }] }).success).toBe(false);
    expect(VariantSchema.safeParse({ specs: [{ label: "", value: "値" }] }).success).toBe(false);
    expect(VariantSchema.safeParse({ specs: [{ label: "項目", value: "" }] }).success).toBe(false);
    expect(VariantSchema.safeParse({ specs: [{ label: "項目", value: "値", extra: true }] }).success).toBe(false);
  });

  it("未設定はundefinedのまま後方互換を保ち、specsだけのSKUは空行として刈り込まない", () => {
    expect(VariantSchema.parse({}).specs).toBeUndefined();
    expect(isEmptyVariant(VariantSchema.parse({ specs: [{ label: "原産国", value: "日本" }] }))).toBe(false);
  });
});
