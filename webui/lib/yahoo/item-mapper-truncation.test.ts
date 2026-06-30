import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { detectYahooTruncations } from "./item-mapper";

/** 商品名(75)/キャッチコピー(30)/商品情報=説明(500) の文字数オーバー検出。 */
describe("detectYahooTruncations — 文字数オーバー検出", () => {
  it("商品名が75全角超 → name 検出（元値/上限つき）", () => {
    const t = detectYahooTruncations(makeProduct({ display_name: "あ".repeat(80) }));
    const name = t.find((x) => x.field === "name");
    expect(name).toBeTruthy();
    expect(name!.limit).toBe(75);
    expect(name!.fullWidthLen).toBe(80);
    expect(name!.original.length).toBe(80);
  });
  it("キャッチコピーが30全角超 → headline 検出", () => {
    expect(
      detectYahooTruncations(makeProduct({ catch_copy_yahoo: "あ".repeat(40) })).some(
        (x) => x.field === "headline",
      ),
    ).toBe(true);
  });
  it("説明が500全角超 → explanation 検出", () => {
    expect(
      detectYahooTruncations(makeProduct({ free1: "あ".repeat(600) })).some(
        (x) => x.field === "explanation",
      ),
    ).toBe(true);
  });
  it("上限内 → 検出なし", () => {
    const p = makeProduct({ display_name: "短い名前", catch_copy_yahoo: "短いコピー", free1: "短い説明" });
    expect(detectYahooTruncations(p)).toEqual([]);
  });
});
