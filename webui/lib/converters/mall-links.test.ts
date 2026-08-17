/** mall-links: 公開リンク一覧（/links/shimanoya）の URL 組み立てと静的異常検出。
 * 楽天 URL は manageNumberOf（rakuten_manage_number 優先）、Yahoo URL は
 * yahooItemsForProduct の SKU 分割（item_code = NEコード）と同じ規則であることを固定する。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import {
  buildMallLinkEntries,
  mallLinkEntryOf,
  rakutenItemUrl,
  yahooItemUrl,
} from "./mall-links";

describe("rakutenItemUrl / yahooItemUrl", () => {
  it("楽天は ichiban-okinawa 配下・末尾スラッシュ", () => {
    expect(rakutenItemUrl("s071-1234")).toBe("https://item.rakuten.co.jp/ichiban-okinawa/s071-1234/");
  });
  it("Yahoo は okimarumarket 配下・.html・小文字化", () => {
    expect(yahooItemUrl("S071-1234-1")).toBe(
      "https://store.shopping.yahoo.co.jp/okimarumarket/s071-1234-1.html",
    );
  });
});

describe("mallLinkEntryOf", () => {
  it("フラット商品: 楽天=管理番号ページ / Yahoo=NEコードページが1件", () => {
    const p = makeProduct({
      ne_code: "s071-1234-1",
      maker_code: "s071",
      jan_code: "4900000001234",
      rakuten_manage_number: "",
      mall_listed: { rakuten: true, yahoo: true },
    });
    const e = mallLinkEntryOf(p);
    expect(e.rakutenManageNumber).toBe("s071-1234");
    expect(e.rakutenUrl).toBe("https://item.rakuten.co.jp/ichiban-okinawa/s071-1234/");
    expect(e.yahoo).toEqual([
      { itemCode: "s071-1234-1", url: "https://store.shopping.yahoo.co.jp/okimarumarket/s071-1234-1.html" },
    ]);
    expect(e.rakutenListed).toBe(true);
    expect(e.yahooListed).toBe(true);
    expect(e.problems).toEqual([]);
  });

  it("取込商品は rakuten_manage_number を最優先で使う", () => {
    const p = makeProduct({ rakuten_manage_number: "imported-code-1" });
    expect(mallLinkEntryOf(p).rakutenUrl).toBe(
      "https://item.rakuten.co.jp/ichiban-okinawa/imported-code-1/",
    );
  });

  it("多SKU(split): Yahoo はSKUごとに別ページ", () => {
    const p = makeProduct({
      ne_code: "s071-1234-1",
      variants: [
        { ne_code: "s071-1234-1", selling_price: 1000 },
        { ne_code: "s071-1234-2", selling_price: 1800 },
      ],
    });
    expect(mallLinkEntryOf(p).yahoo.map((y) => y.itemCode)).toEqual([
      "s071-1234-1",
      "s071-1234-2",
    ]);
  });

  it("多SKU(unified): Yahoo は親1ページのみ", () => {
    const p = makeProduct({
      ne_code: "s071-1234-1",
      yahoo_variation_mode: "unified",
      variants: [
        { ne_code: "s071-1234-1", selling_price: 1000 },
        { ne_code: "s071-1234-2", selling_price: 1800 },
      ],
    });
    expect(mallLinkEntryOf(p).yahoo.map((y) => y.itemCode)).toEqual(["s071-1234-1"]);
  });

  it("mall_listed 未設定でも rakuten_manage_number があれば楽天掲載扱い（後方互換）", () => {
    const p = makeProduct({ mall_listed: {}, rakuten_manage_number: "s071-9999" });
    const e = mallLinkEntryOf(p);
    expect(e.rakutenListed).toBe(true);
    expect(e.yahooListed).toBe(false);
  });

  it("書式異常を problems に載せる（楽天大文字 / Yahoo 不正文字）", () => {
    const upper = makeProduct({ rakuten_manage_number: "S071-BAD" });
    expect(mallLinkEntryOf(upper).problems.join()).toContain("書式が不正");

    const badYahoo = makeProduct({ ne_code: "s071_1234_1", rakuten_manage_number: "s071-1234" });
    const e = mallLinkEntryOf(badYahoo);
    expect(e.yahoo).toEqual([]);
    expect(e.problems.join()).toContain("Yahoo 商品コードの書式が不正");
  });
});

describe("buildMallLinkEntries", () => {
  it("別商品が同じ Yahoo コードを指したら重複として検出する", () => {
    const a = makeProduct({ ne_code: "s071-0001-1", jan_code: "4900000000011" });
    const b = makeProduct({ ne_code: "s071-0002-1", jan_code: "4900000000028" });
    const dup = makeProduct({
      ne_code: "s071-0003-1",
      jan_code: "4900000000035",
      variants: [
        { ne_code: "s071-0001-1", selling_price: 500 },
        { ne_code: "s071-0003-2", selling_price: 700 },
      ],
    });
    const entries = buildMallLinkEntries([a, b, dup]);
    expect(entries[0].problems).toEqual([]);
    expect(entries[1].problems).toEqual([]);
    expect(entries[2].problems.join()).toContain('Yahoo 商品コード "s071-0001-1" が s071-0001-1');
  });

  it("同じ楽天管理番号の共有（SKU行分割 peers）は異常扱いしない", () => {
    const a = makeProduct({ ne_code: "s071-0001-1", rakuten_manage_number: "s071-0001" });
    const b = makeProduct({ ne_code: "s071-0001-2", rakuten_manage_number: "s071-0001", jan_code: "4900000000028" });
    const entries = buildMallLinkEntries([a, b]);
    expect(entries.flatMap((e) => e.problems)).toEqual([]);
  });
});
