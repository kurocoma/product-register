import { describe, it, expect } from "vitest";
import { makeProduct } from "./schema";
import {
  productInputToDbRow,
  dbRowToProductInput,
  validateForSave,
  humanizeSaveError,
  type ProductRow,
} from "./repository";

describe("validateForSave", () => {
  it("rejects empty ne_code", () => {
    const p = makeProduct({ ne_code: "" });
    const result = validateForSave(p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("NEコード");
  });

  it("rejects whitespace-only ne_code", () => {
    const p = makeProduct({ ne_code: "   " });
    expect(validateForSave(p).ok).toBe(false);
  });

  it("accepts product with non-empty ne_code", () => {
    const p = makeProduct({ ne_code: "t002-2542-1" });
    expect(validateForSave(p).ok).toBe(true);
  });
});

describe("humanizeSaveError", () => {
  it("converts 23505 unique violation into a clear NE code message", () => {
    const err = { code: "23505", message: 'duplicate key value violates unique constraint "products_user_id_ne_code_key"' };
    const msg = humanizeSaveError(err);
    expect(msg).toContain("NEコード");
    expect(msg).toContain("既に");
  });

  it("passes through other error messages", () => {
    const err = { code: "12345", message: "some other db error" };
    expect(humanizeSaveError(err)).toContain("some other db error");
  });
});

describe("productInputToDbRow", () => {
  it("separates main columns and extra fields", () => {
    const p = makeProduct({ free1: "free1 text", keyword: "kw" });
    const row = productInputToDbRow(p);
    // main column
    expect(row.ne_code).toBe("t002-2542-1");
    expect(row.selling_price).toBe(10000);
    // extra
    const extra = row.extra as Record<string, unknown>;
    expect(extra.free1).toBe("free1 text");
    expect(extra.keyword).toBe("kw");
  });

  it("excludes is_single/is_set derived fields", () => {
    const p = makeProduct();
    const row = productInputToDbRow(p);
    expect("is_single" in row).toBe(false);
    expect("is_set" in row).toBe(false);
    expect("is_single" in (row.extra as object)).toBe(false);
  });
});

describe("dbRowToProductInput", () => {
  it("round-trip preserves all fields", () => {
    const p = makeProduct({
      ne_code: "t002-2542-3",
      product_type: "セット商品",
      quantity: 3,
      free1: "test free1",
      image_url_1: "https://example.com/a.jpg",
      attribute_item_1: "原材料",
      attribute_value_1: "米",
    });
    const dbRow = productInputToDbRow(p);
    const fakeRow: ProductRow = {
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      created_at: "2026-05-27T00:00:00Z",
      updated_at: "2026-05-27T00:00:00Z",
      extra: dbRow.extra as Record<string, unknown>,
      ...(dbRow as Record<typeof MAIN_KEYS[number], unknown>),
    } as ProductRow;
    const restored = dbRowToProductInput(fakeRow);
    expect(restored.ne_code).toBe("t002-2542-3");
    expect(restored.quantity).toBe(3);
    expect(restored.free1).toBe("test free1");
    expect(restored.image_url_1).toBe("https://example.com/a.jpg");
    expect(restored.attribute_item_1).toBe("原材料");
    expect(restored.attribute_value_1).toBe("米");
    expect(restored.is_set).toBe(true);
  });
});

// 型保守用のキー
const MAIN_KEYS = ["ne_code"] as const;
