import { describe, it, expect } from "vitest";
import {
  buildRakutenImgList,
  buildYahooImgListHtml,
  buildYahooItemImageUrls,
} from "./image-url";

describe("buildRakutenImgList", () => {
  it("image_count <= 1 returns empty string", () => {
    expect(buildRakutenImgList("t002-2542", 0)).toBe("");
    expect(buildRakutenImgList("t002-2542", 1)).toBe("");
  });
  it("image_count=3 returns 2 img tags wrapped", () => {
    const html = buildRakutenImgList("t002-2542", 3);
    expect(html).toContain("<!--imgList-->");
    expect(html).toContain("<!--/imgList-->");
    expect(html).toContain("t002-2542_2.jpg");
    expect(html).toContain("t002-2542_3.jpg");
  });
});

describe("buildYahooItemImageUrls", () => {
  it("image_count=0 returns empty", () => {
    expect(buildYahooItemImageUrls("x", 0)).toBe("");
  });
  it("image_count=1 returns single URL without suffix", () => {
    const url = buildYahooItemImageUrls("t002-2542-1", 1);
    expect(url).toBe("https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg");
  });
  it("image_count=3 returns 3 URLs semicolon separated", () => {
    const url = buildYahooItemImageUrls("t002-2542-1", 3);
    const parts = url.split(";");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg");
    expect(parts[1]).toBe("https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_2.jpg");
    expect(parts[2]).toBe("https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_3.jpg");
  });
});

describe("buildYahooImgListHtml", () => {
  it("image_count <= 1 returns empty", () => {
    expect(buildYahooImgListHtml("t002-2542-1", 1)).toBe("");
  });
  it("image_count=3 wraps 2 imgs", () => {
    const html = buildYahooImgListHtml("t002-2542-1", 3);
    expect(html).toContain("<!--imgList-->");
    expect(html).toContain("t002-2542-1_2.jpg");
  });
});
