import { describe, it, expect } from "vitest";
import { validateEditItemParams } from "./item-mapper";

/** B1-B4 値域ゲート: price / item_code / product_category の値域違反を dry-run で前倒し検知する。
 *  shape は従来どおり {ok:true} | {ok:false; missing:string[]} を維持する。 */

const base = {
  seller_id: "S",
  item_code: "c-1",
  path: "食品:酒",
  name: "商品名",
  product_category: "13457",
  price: "1000",
};

describe("validateEditItemParams — price 値域 (B1)", () => {
  it("正常な価格は ok", () => {
    expect(validateEditItemParams(base)).toEqual({ ok: true });
    expect(validateEditItemParams({ ...base, price: "1" }).ok).toBe(true);
    expect(validateEditItemParams({ ...base, price: "99999999" }).ok).toBe(true);
  });

  it("0 / 範囲外 / 非数値 / 小数 は ok:false で price を surface", () => {
    for (const bad of ["0", "100000000", "abc", "1.5", "-5"]) {
      const r = validateEditItemParams({ ...base, price: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.missing.some((m) => m.includes("price"))).toBe(true);
    }
  });
});

describe("validateEditItemParams — item_code 書式 (B2)", () => {
  it("半角英数とハイフンのみ・99文字以内は ok", () => {
    expect(validateEditItemParams({ ...base, item_code: "ABC-123" }).ok).toBe(true);
    expect(validateEditItemParams({ ...base, item_code: "a".repeat(99) }).ok).toBe(true);
  });

  it("アンダースコア等の不正文字 / 99文字超 は ok:false で item_code を surface", () => {
    for (const bad of ["NE_1", "a b", "コード", "a".repeat(100)]) {
      const r = validateEditItemParams({ ...base, item_code: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.missing.some((m) => m.includes("item_code"))).toBe(true);
    }
  });
});

describe("validateEditItemParams — product_category 書式 (B3)", () => {
  it("数字 1〜10 桁は ok", () => {
    expect(validateEditItemParams({ ...base, product_category: "1" }).ok).toBe(true);
    expect(validateEditItemParams({ ...base, product_category: "1234567890" }).ok).toBe(true);
  });

  it("非数値 / 11桁以上 は ok:false で product_category を surface", () => {
    for (const bad of ["abc", "12345678901", "12.3", "1a"]) {
      const r = validateEditItemParams({ ...base, product_category: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.missing.some((m) => m.includes("product_category"))).toBe(true);
    }
  });
});
