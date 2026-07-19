/** 編集画面ヘッダの補足コード表示（productCodeSummary）の回帰テスト。
 * 多SKU統合商品で「楽天管理番号・各SKUのコード」が代表コードの横に明示されること
 * （commit ce6278e）。フラット商品では何も出さない。 */
import { describe, expect, it } from "vitest";
import { productCodeSummary } from "./code-summary";

describe("productCodeSummary", () => {
  it("実データ相当（代表 rs74-5・楽天管理番号 r74-1・SKU 3種）で補足文を組み立てる", () => {
    expect(
      productCodeSummary({
        ne_code: "rs74-5",
        rakuten_manage_number: "r74-1",
        variants: [
          { ne_code: "rs74-5", variation_value: "5個" },
          { ne_code: "rs74-3", variation_value: "3個" },
          { ne_code: "r74-1", variation_value: "1個" },
        ],
      }),
    ).toBe("楽天管理番号 r74-1 ・ SKU 3種: 5個(rs74-5) / 3個(rs74-3) / 1個(r74-1)");
  });

  it("フラット商品（variants なし・楽天管理番号なし）は null（補足を出さない）", () => {
    expect(productCodeSummary({ ne_code: "a-1" })).toBe(null);
  });

  it("楽天管理番号が代表 ne_code と同じなら繰り返さない（null）", () => {
    expect(productCodeSummary({ ne_code: "a-1", rakuten_manage_number: "a-1" })).toBe(null);
  });

  it("SKU が1件だけならフラット扱いで SKU 部は出さない", () => {
    expect(productCodeSummary({ ne_code: "a-1", variants: [{ ne_code: "a-1" }] })).toBe(null);
  });

  it("variation_value が無い SKU はコードのみ、コードも無ければ (コード未設定) を出す", () => {
    expect(
      productCodeSummary({
        ne_code: "a-1",
        variants: [{ ne_code: "a-1" }, { sku_manage_number: "sku-b" }, {}],
      }),
    ).toBe("SKU 3種: a-1 / sku-b / (コード未設定)");
  });
});
