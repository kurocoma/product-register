import { describe, expect, it } from "vitest";
import type { IchibaSearchItem } from "@/lib/rakuten";
import {
  competitorMaxRate,
  filterCompetitors,
  nameMatchScore,
  normalizeNameKeyword,
  tokenize,
} from "./matcher";

const item = (over: Partial<IchibaSearchItem>): IchibaSearchItem => ({
  itemName: "ランドリン 柔軟剤 クラシックフローラル 8個セット",
  itemCode: "shop-a:10001",
  itemPrice: 5000,
  pointRate: 1,
  shopCode: "shop-a",
  shopName: "ショップA",
  itemUrl: "https://item.rakuten.co.jp/shop-a/10001/",
  ...over,
});

describe("filterCompetitors", () => {
  it("自店を除外する", () => {
    const items = [item({ shopCode: "ichiban-okinawa" }), item({ shopCode: "shop-b" })];
    const out = filterCompetitors(items, { ownShopCode: "ichiban-okinawa", ownPrice: 5000 });
    expect(out.map((c) => c.shopCode)).toEqual(["shop-b"]);
  });

  it("価格帯ガード: 自店価格の0.5〜2.0倍のみ残す（入数違いの混入防止）", () => {
    const items = [
      item({ shopCode: "cheap", itemPrice: 600 }),   // 単品らしき価格 → 除外
      item({ shopCode: "low-ok", itemPrice: 2500 }),  // 下限ちょうど
      item({ shopCode: "high-ok", itemPrice: 10000 }), // 上限ちょうど
      item({ shopCode: "too-high", itemPrice: 10001 }),
    ];
    const out = filterCompetitors(items, { ownShopCode: "me", ownPrice: 5000 });
    expect(out.map((c) => c.shopCode)).toEqual(["low-ok", "high-ok"]);
  });

  it("自店価格が不明(0)なら価格帯ガードは効かせない", () => {
    const items = [item({ shopCode: "any", itemPrice: 100 })];
    expect(filterCompetitors(items, { ownShopCode: "me", ownPrice: 0 })).toHaveLength(1);
  });

  it("商品名検索時は一致度が低いヒットを落とす", () => {
    const items = [
      item({ shopCode: "match", itemName: "ランドリン 柔軟剤 クラシックフローラル 8個セット 送料無料" }),
      item({ shopCode: "differ", itemName: "レノア ハピネス 詰め替え 10袋" }),
    ];
    const out = filterCompetitors(items, {
      ownShopCode: "me",
      ownPrice: 5000,
      ownName: "ランドリン 柔軟剤 クラシックフローラル 8個セット",
    });
    expect(out.map((c) => c.shopCode)).toEqual(["match"]);
  });
});

describe("competitorMaxRate", () => {
  const comp = (shopCode: string, itemPrice: number, pointRate: number) => ({
    shopCode, shopName: shopCode, itemName: "", itemPrice, pointRate, itemUrl: "",
  });

  it("最安値上位N店の最大倍率を返す（N圏外の高倍率は無視）", () => {
    const comps = [comp("a", 1000, 1), comp("b", 1100, 2), comp("c", 1200, 1), comp("d", 5000, 10)];
    expect(competitorMaxRate(comps, 3)).toBe(2);
  });

  it("競合なしは null", () => {
    expect(competitorMaxRate([], 3)).toBeNull();
  });

  it("価格順に並べ替えてから上位を取る", () => {
    const comps = [comp("high", 9000, 9), comp("low", 1000, 2)];
    expect(competitorMaxRate(comps, 1)).toBe(2);
  });
});

describe("tokenize / nameMatchScore", () => {
  it("記号・括弧を除いて2文字以上のトークンに分割する", () => {
    expect(tokenize("【送料無料】ランドリン (8個セット)")).toEqual(["送料無料", "ランドリン", "8個セット"]);
  });

  it("一致度は自店トークンの包含割合", () => {
    const score = nameMatchScore("ランドリン 柔軟剤 8個セット", "ランドリン 柔軟剤 クラシック 8個セット 送料無料");
    expect(score).toBe(1);
    expect(nameMatchScore("ランドリン 柔軟剤", "レノア ハピネス")).toBe(0);
  });
});

describe("normalizeNameKeyword", () => {
  it("連続空白を1つにし、長すぎる名前は切り詰める", () => {
    expect(normalizeNameKeyword("  ランドリン   柔軟剤  ")).toBe("ランドリン 柔軟剤");
    expect(normalizeNameKeyword("あ".repeat(100))).toHaveLength(60);
  });
});
