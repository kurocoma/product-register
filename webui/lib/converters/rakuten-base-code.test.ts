/** baseCodeOf の maker_code 空フォールバックのテスト。
 * 背景: maker_code が空だと base が「-1149」のような先頭ハイフン名になり、
 * 画像ファイル名・管理番号フォールバックが異常な値になる（r2201-1 実件）。
 * 対策: maker 空なら ne_code、それも空なら item-{JAN下4桁} を使う。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { baseCodeOf } from "./rakuten";
import { buildRakutenManageNumber, buildUpsertImages } from "./rakuten-api";

describe("baseCodeOf: maker_code 空のフォールバック", () => {
  it("maker_code があれば従来どおり {maker}-{JAN下4桁}", () => {
    expect(baseCodeOf(makeProduct({ maker_code: "t002", jan_code: "4582469492542" }))).toBe("t002-2542");
  });

  it("maker_code 空なら ne_code を使う（先頭ハイフン名を防ぐ）", () => {
    expect(
      baseCodeOf(makeProduct({ maker_code: "", ne_code: "r2201-1", jan_code: "4589837521149" })),
    ).toBe("r2201-1");
  });

  it("maker_code も ne_code も空なら item-{JAN下4桁}", () => {
    expect(baseCodeOf(makeProduct({ maker_code: "", ne_code: "", jan_code: "4589837521149" }))).toBe("item-1149");
  });

  it("規約フォールバックの画像名も -1149_2 ではなく r2201-1_2 になる", () => {
    const p = makeProduct({ maker_code: "", ne_code: "r2201-1", jan_code: "4589837521149", image_count: 2 });
    expect(buildUpsertImages(p).map((x) => x.location)).toEqual([
      "/thum02/r2201-1.jpg",
      "/thum02/r2201-1_2.jpg",
    ]);
  });

  it("管理番号フォールバック（rakuten_manage_number 未保存）も -1149 にならない", () => {
    const p = makeProduct({
      maker_code: "", ne_code: "r2201-1", jan_code: "4589837521149", rakuten_manage_number: "",
    });
    expect(buildRakutenManageNumber(p)).toBe("r2201-1");
  });
});
