import { describe, it, expect } from "vitest";
import { validateYahooSubscription } from "./subscription";
import { buildYahooVariationParams } from "./variation-params";
import { makeProduct } from "@/lib/product/schema";

/** Yahoo 定期購入の送信前検証（260711修正依頼-Task7）。
 * 期待値は資料 yahoo-subscription-product-registration.md §5〜7 の仕様値
 * （type別必須 / 価格1〜99,999,999 / group1〜20 / cycle 0・1:10〜90・2:1〜6 / point1〜15 /
 *  type1 定期≦通常 / type2 同額 / 個別商品価格との併用不可 it-14180）。 */

/** type=1 の正常系パラメータ（editItem 送信形 = 税込変換済みの文字列）。 */
function validType1(over: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    seller_id: "teststore",
    item_code: "item-001",
    price: "3980",
    subscription_type: "1",
    subscription_price: "3580",
    subscription_group_index: "1",
    subscription_recommended_cycle: "2:1",
    ...over,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  return out;
}

function errorsOf(params: Record<string, string>): string[] {
  const r = validateYahooSubscription(params);
  return r.ok ? [] : r.errors;
}

describe("validateYahooSubscription — type=0（設定なし/無効化）", () => {
  it("subscription_type=0 のみ（関連4項目なし）→ OK", () => {
    expect(validateYahooSubscription({ price: "3980", subscription_type: "0" }).ok).toBe(true);
  });
  it("subscription_type 未設定（定期購入に触れない送信）→ OK", () => {
    expect(validateYahooSubscription({ price: "3980" }).ok).toBe(true);
  });
  it.each([
    ["subscription_price", "3580"],
    ["subscription_group_index", "1"],
    ["subscription_recommended_cycle", "1:30"],
    ["subscription_point_code", "2"],
  ])("type=0 で %s を送る → エラー（it-14107/14110/14123 の前倒し）", (key, value) => {
    const errs = errorsOf({ price: "3980", subscription_type: "0", [key]: value });
    expect(errs.some((e) => e.includes(key))).toBe(true);
  });
});

describe("validateYahooSubscription — type の値域（it-14093）", () => {
  it.each(["3", "-1", "abc"])("type=%s → エラー", (t) => {
    const errs = errorsOf(validType1({ subscription_type: t }));
    expect(errs.some((e) => e.includes("0/1/2"))).toBe(true);
  });
});

describe("validateYahooSubscription — 定期購入価格（it-14099〜14101）", () => {
  it("type=1 で価格未設定 → 必須エラー", () => {
    const errs = errorsOf(validType1({ subscription_price: undefined }));
    expect(errs.some((e) => e.includes("必須"))).toBe(true);
  });
  it("下限 1 円 → OK（通常価格以下の範囲で）", () => {
    expect(validateYahooSubscription(validType1({ subscription_price: "1" })).ok).toBe(true);
  });
  it("上限 99,999,999 円 → 値域は OK（通常価格超過の別エラーのみ）", () => {
    const errs = errorsOf(validType1({ subscription_price: "99999999", price: "99999999" }));
    expect(errs).toEqual([]);
  });
  it("0 円 → エラー", () => {
    const errs = errorsOf(validType1({ subscription_price: "0", price: "3980" }));
    expect(errs.some((e) => e.includes("1〜99,999,999"))).toBe(true);
  });
  it("100,000,000 円（上限+1）→ エラー", () => {
    const errs = errorsOf(validType1({ subscription_price: "100000000", price: "100000000" }));
    expect(errs.some((e) => e.includes("1〜99,999,999"))).toBe(true);
  });
  it("小数 → エラー（整数のみ）", () => {
    const errs = errorsOf(validType1({ subscription_price: "3580.5" }));
    expect(errs.some((e) => e.includes("整数"))).toBe(true);
  });
});

describe("validateYahooSubscription — 通常価格・会員価格との関係（it-14104/14105）", () => {
  it("type=1: 定期価格 > 通常価格 → エラー", () => {
    const errs = errorsOf(validType1({ subscription_price: "3981", price: "3980" }));
    expect(errs.some((e) => e.includes("以下"))).toBe(true);
  });
  it("type=1: 定期価格 = 通常価格 → OK（同額は許容）", () => {
    expect(validateYahooSubscription(validType1({ subscription_price: "3980", price: "3980" })).ok).toBe(true);
  });
  it("type=1: 会員価格があれば定期価格はそれ以下（超過 → エラー）", () => {
    const errs = errorsOf(validType1({ subscription_price: "3580", member_price: "3500" }));
    expect(errs.some((e) => e.includes("会員価格"))).toBe(true);
  });
  it("type=2: 定期価格 ≠ 通常価格 → エラー（同額強制）", () => {
    const errs = errorsOf(validType1({ subscription_type: "2", subscription_price: "3580", price: "3980" }));
    expect(errs.some((e) => e.includes("同額"))).toBe(true);
  });
  it("type=2: 定期価格 = 通常価格 → OK", () => {
    expect(
      validateYahooSubscription(validType1({ subscription_type: "2", subscription_price: "3980", price: "3980" })).ok,
    ).toBe(true);
  });
  it("type=2: セール価格あり → エラー（it-14102）", () => {
    const errs = errorsOf(
      validType1({ subscription_type: "2", subscription_price: "3980", price: "3980", sale_price: "3500" }),
    );
    expect(errs.some((e) => e.includes("セール価格"))).toBe(true);
  });
  it("type=2: 会員価格あり → エラー（it-14103）", () => {
    const errs = errorsOf(
      validType1({ subscription_type: "2", subscription_price: "3980", price: "3980", member_price: "3900" }),
    );
    expect(errs.some((e) => e.includes("会員価格"))).toBe(true);
  });
});

describe("validateYahooSubscription — グループ管理番号（it-14106〜14109）", () => {
  it("type=1 で未設定 → 必須エラー", () => {
    const errs = errorsOf(validType1({ subscription_group_index: undefined }));
    expect(errs.some((e) => e.includes("グループ管理番号") && e.includes("必須"))).toBe(true);
  });
  it.each(["1", "20"])("境界値 %s → OK", (g) => {
    expect(validateYahooSubscription(validType1({ subscription_group_index: g })).ok).toBe(true);
  });
  it.each(["0", "21", "1.5", "x"])("値域外 %s → エラー", (g) => {
    const errs = errorsOf(validType1({ subscription_group_index: g }));
    expect(errs.some((e) => e.includes("1〜20"))).toBe(true);
  });
});

describe("validateYahooSubscription — おすすめサイクル（it-14111）", () => {
  it.each(["", "0", "1:10", "1:90", "2:1", "2:6"])("受理: %s", (c) => {
    expect(validateYahooSubscription(validType1({ subscription_recommended_cycle: c })).ok).toBe(true);
  });
  it.each(["1:9", "1:91", "2:0", "2:7", "3:5", "10", "1:10:2", "1:", "day:30"])("拒否: %s", (c) => {
    const errs = errorsOf(validType1({ subscription_recommended_cycle: c }));
    expect(errs.some((e) => e.includes("サイクル"))).toBe(true);
  });
});

describe("validateYahooSubscription — ポイント倍率（it-14123〜14126）", () => {
  it("未設定（パラメータなし）→ OK（0=未設定は省略して送る仕様）", () => {
    expect(validateYahooSubscription(validType1({ subscription_point_code: undefined })).ok).toBe(true);
  });
  it.each(["1", "15"])("境界値 %s → OK", (p) => {
    expect(validateYahooSubscription(validType1({ subscription_point_code: p })).ok).toBe(true);
  });
  it.each(["0", "16", "-1", "1.5"])("値域外 %s → エラー（0 は省略すべきで送信は不可）", (p) => {
    const errs = errorsOf(validType1({ subscription_point_code: p }));
    expect(errs.some((e) => e.includes("1〜15"))).toBe(true);
  });
});

describe("validateYahooSubscription — 個別商品価格との併用不可（it-14180）", () => {
  it("subcode_param に price 指定あり + type=1 → エラー", () => {
    const errs = errorsOf(validType1({ subcode_param: "a-1=price:1100|a-2=price:2200" }));
    expect(errs.some((e) => e.includes("it-14180"))).toBe(true);
  });
  it("subcode_param が price 以外（在庫等）→ OK", () => {
    expect(validateYahooSubscription(validType1({ subcode_param: "a-1=stock:5" })).ok).toBe(true);
  });
  it("unified バリエーションで SKU 価格が異なる商品（buildYahooVariationParams の実出力）+ 定期購入 → エラー", () => {
    // SKU 間で価格が異なる unified 商品 → variation-params が subcode_param に price を載せる
    const p = makeProduct({
      yahoo_variation_mode: "unified",
      variation_name: "本数",
      variants: [
        { ne_code: "a-1", jan_code: "4900000000001", selling_price: 1000, tax_rate: 10, quantity: 1, variation_value: "1本" },
        { ne_code: "a-2", jan_code: "4900000000002", selling_price: 2000, tax_rate: 10, quantity: 2, variation_value: "2本" },
      ],
    });
    const vr = buildYahooVariationParams(p);
    if (!vr.ok) throw new Error("variation params should build");
    expect(vr.params.subcode_param).toContain("price:");
    const errs = errorsOf(validType1({ subcode_param: vr.params.subcode_param! }));
    expect(errs.some((e) => e.includes("it-14180"))).toBe(true);
  });
  it("unified でも全SKU同一価格（subcode_param なし）→ OK（商品レベル定期価格を共有）", () => {
    const p = makeProduct({
      yahoo_variation_mode: "unified",
      variation_name: "本数",
      variants: [
        { ne_code: "a-1", jan_code: "4900000000001", selling_price: 1000, tax_rate: 10, quantity: 1, variation_value: "1本" },
        { ne_code: "a-2", jan_code: "4900000000002", selling_price: 1000, tax_rate: 10, quantity: 2, variation_value: "2本" },
      ],
    });
    const vr = buildYahooVariationParams(p);
    if (!vr.ok) throw new Error("variation params should build");
    expect(vr.params.subcode_param).toBeUndefined();
    expect(validateYahooSubscription(validType1({})).ok).toBe(true);
  });
});
