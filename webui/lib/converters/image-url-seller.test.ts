import { describe, it, expect } from "vitest";
import { buildYahooImageUrls, buildYahooItemImageUrls } from "./image-url";

/** A3: item_image_urls の lib 基底URL を sellerId で動的化する。
 *  sellerId 指定時は https://shopping.c.yimg.jp/lib/{sellerId}、未指定は従来(okimarumarket)。 */

const DEFAULT_BASE = "https://shopping.c.yimg.jp/lib/okimarumarket";

describe("buildYahooItemImageUrls — sellerId 動的化 (A3)", () => {
  it("sellerId 指定で base が lib/{sellerId} を反映する", () => {
    const url = buildYahooItemImageUrls("t002-1", 2, "myshop");
    const parts = url.split(";");
    expect(parts[0]).toBe("https://shopping.c.yimg.jp/lib/myshop/t002-1.jpg");
    expect(parts[1]).toBe("https://shopping.c.yimg.jp/lib/myshop/t002-1_2.jpg");
  });

  it("sellerId 未指定は従来の okimarumarket 基底（後方互換）", () => {
    const url = buildYahooItemImageUrls("t002-1", 2);
    const parts = url.split(";");
    expect(parts[0]).toBe(`${DEFAULT_BASE}/t002-1.jpg`);
    expect(parts[1]).toBe(`${DEFAULT_BASE}/t002-1_2.jpg`);
  });
});

describe("buildYahooImageUrls — index 配列駆動 + sellerId (A2/A3)", () => {
  it("index 配列を渡すと指定 index のみで URL を生成する", () => {
    const urls = buildYahooImageUrls("ne-x", [1, 3], "myshop");
    expect(urls).toEqual([
      "https://shopping.c.yimg.jp/lib/myshop/ne-x.jpg",
      "https://shopping.c.yimg.jp/lib/myshop/ne-x_3.jpg",
    ]);
  });

  it("index 配列 + sellerId 未指定は従来基底で生成する（後方互換）", () => {
    const urls = buildYahooImageUrls("ne-x", [2]);
    expect(urls).toEqual([`${DEFAULT_BASE}/ne-x_2.jpg`]);
  });

  it("枚数(number)指定の従来挙動は不変（1..count の連番）", () => {
    const urls = buildYahooImageUrls("ne-x", 3);
    expect(urls).toEqual([
      `${DEFAULT_BASE}/ne-x.jpg`,
      `${DEFAULT_BASE}/ne-x_2.jpg`,
      `${DEFAULT_BASE}/ne-x_3.jpg`,
    ]);
    expect(buildYahooImageUrls("ne-x", 0)).toEqual([]);
  });
});
