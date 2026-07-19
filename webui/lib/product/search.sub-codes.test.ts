/** 一覧検索の SKU コード対応（sub_codes）の回帰テスト。
 * 背景: 3SKU統合商品（代表 rs74-5、SKU に r74-1、楽天管理番号 r74-1）が
 * 「r74-1」で検索できなかった（commit ce6278e で修正）。
 * 検索対象: 代表 ne_code・商品名・JAN ＋ SKUの ne_code / SKU管理番号 / 楽天管理番号。 */
import { describe, expect, it } from "vitest";
import { matchesProductQuery, productSubCodes } from "./search";

const base = {
  ne_code: "rs74-5",
  product_name: "鉄と葉酸とコラーゲンのゼリー",
  jan_code: "4589837521187",
};

describe("matchesProductQuery: sub_codes（SKU・モール管理番号）", () => {
  it("sub_codes に含まれる SKU の ne_code でヒットする", () => {
    expect(
      matchesProductQuery({ ...base, sub_codes: ["rs74-5", "rs74-3", "r74-1"] }, "r74-1"),
    ).toBe(true);
  });

  it("sub_codes が無ければ代表コード・商品名・JAN のみ（従来挙動の固定）", () => {
    expect(matchesProductQuery(base, "r74-1")).toBe(false);
  });

  it("sub_codes も大文字小文字を無視して部分一致する", () => {
    expect(matchesProductQuery({ ...base, sub_codes: ["r74-1"] }, "R74-1")).toBe(true);
  });

  it("sub_codes の空文字要素は何にもマッチしない", () => {
    expect(matchesProductQuery({ ...base, sub_codes: [""] }, "x")).toBe(false);
  });

  it("query 空（空白のみ）のときは sub_codes があっても常に true（従来どおり）", () => {
    expect(matchesProductQuery({ ...base, sub_codes: ["r74-1"] }, "  ")).toBe(true);
  });
});

describe("productSubCodes: extra からの検索対象コード収集", () => {
  it("SKUの ne_code / SKU管理番号 / 楽天管理番号を集め、空文字除外・重複除去する", () => {
    expect(
      productSubCodes({
        variants: [
          { ne_code: "r74-1", sku_manage_number: "r74-1" },
          { ne_code: "rs74-3" },
          { ne_code: "" },
        ],
        rakuten_manage_number: "r74-1",
      }),
    ).toEqual(["r74-1", "rs74-3"]);
  });

  it("extra が null / variants が想定外の形でも落ちずに空配列を返す", () => {
    expect(productSubCodes(null)).toEqual([]);
    expect(productSubCodes({ variants: "broken" })).toEqual([]);
  });
});
