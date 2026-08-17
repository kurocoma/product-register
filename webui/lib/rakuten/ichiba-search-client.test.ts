import { afterEach, describe, expect, it, vi } from "vitest";
import { isIchibaRateLimited, searchIchibaItems } from "./ichiba-search-client";

const okBody = JSON.stringify({
  count: 2,
  Items: [
    {
      itemName: "ランドリン 8個セット",
      itemCode: "shop-a:10001",
      itemPrice: 4980,
      pointRate: 2,
      shopCode: "shop-a",
      shopName: "ショップA",
      itemUrl: "https://item.rakuten.co.jp/shop-a/10001/",
      postageFlag: 0,
      availability: 1,
    },
    // shopCode 欠落の壊れた行は除外される
    { itemName: "壊れた行", itemPrice: 100 },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchIchibaItems", () => {
  it("applicationId・価格昇順・formatVersion=2 でリクエストし、items を正規化して返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(okBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchIchibaItems("app-123", { keyword: "4900000000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ shopCode: "shop-a", itemPrice: 4980, pointRate: 2 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601",
    );
    expect(url.searchParams.get("applicationId")).toBe("app-123");
    expect(url.searchParams.get("keyword")).toBe("4900000000001");
    expect(url.searchParams.get("sort")).toBe("+itemPrice");
    expect(url.searchParams.get("formatVersion")).toBe("2");
    expect(url.searchParams.get("availability")).toBe("1");
    expect(url.searchParams.get("hits")).toBe("30");
  });

  it("エラー応答は ok:false と整形メッセージ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "wrong_parameter", error_description: "keyword is not valid" }), {
          status: 400,
        }),
      ),
    );
    const result = await searchIchibaItems("app-123", { keyword: "" });
    expect(result).toEqual({ ok: false, status: 400, message: "wrong_parameter: keyword is not valid" });
  });

  it("pointRate 未設定は1倍として扱う", async () => {
    const body = JSON.stringify({
      count: 1,
      Items: [{ itemName: "x", itemCode: "s:1", itemPrice: 100, shopCode: "s", shopName: "S", itemUrl: "" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const result = await searchIchibaItems("app-123", { keyword: "x" });
    expect(result.ok && result.items[0].pointRate).toBe(1);
  });
});

describe("isIchibaRateLimited", () => {
  it("429/503 のみレート制限として扱う", () => {
    expect(isIchibaRateLimited({ ok: false, status: 429, message: "" })).toBe(true);
    expect(isIchibaRateLimited({ ok: false, status: 503, message: "" })).toBe(true);
    expect(isIchibaRateLimited({ ok: false, status: 400, message: "" })).toBe(false);
    expect(isIchibaRateLimited({ ok: true, items: [], totalCount: 0 })).toBe(false);
  });
});
