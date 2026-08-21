import { afterEach, describe, expect, it, vi } from "vitest";
import { isIchibaRateLimited, searchIchibaItems } from "./ichiba-search-client";

const AUTH = { applicationId: "app-123", accessKey: "ak-456" };

// 2026年インフラ刷新後の形式（レスポンスキーは小文字 items）
const okBody = JSON.stringify({
  count: 2,
  items: [
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
  it("新エンドポイント・accessKeyヘッダ・価格昇順・formatVersion=2 でリクエストし、items を正規化して返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(okBody, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchIchibaItems(AUTH, { keyword: "4900000000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ shopCode: "shop-a", itemPrice: 4980, pointRate: 2 });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701",
    );
    expect(url.searchParams.get("applicationId")).toBe("app-123");
    expect(url.searchParams.get("keyword")).toBe("4900000000001");
    expect(url.searchParams.get("sort")).toBe("+itemPrice");
    expect(url.searchParams.get("formatVersion")).toBe("2");
    expect(url.searchParams.get("availability")).toBe("1");
    expect(url.searchParams.get("hits")).toBe("30");

    // accessKey はヘッダで送る（URLに載せない = ログ露出防止）
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("accessKey")).toBe("ak-456");
    expect(url.searchParams.get("accessKey")).toBeNull();
  });

  it("旧形式（Items 大文字）のレスポンスにもフォールバックで対応する", async () => {
    const legacyBody = JSON.stringify({
      count: 1,
      Items: [
        { itemName: "旧形式", itemCode: "s:1", itemPrice: 100, pointRate: 3, shopCode: "s", shopName: "S", itemUrl: "" },
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(legacyBody, { status: 200 })));
    const result = await searchIchibaItems(AUTH, { keyword: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ shopCode: "s", pointRate: 3 });
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
    const result = await searchIchibaItems(AUTH, { keyword: "" });
    expect(result).toEqual({ ok: false, status: 400, message: "wrong_parameter: keyword is not valid" });
  });

  it("ネットワーク断は throw せず ok:false / status:0 を返す（連続失敗ブレーカー用）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await searchIchibaItems(AUTH, { keyword: "4900000000001" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(0);
    expect(result.message).toContain("ネットワークエラー");
  });

  it("pointRate 未設定は1倍として扱う", async () => {
    const body = JSON.stringify({
      count: 1,
      items: [{ itemName: "x", itemCode: "s:1", itemPrice: 100, shopCode: "s", shopName: "S", itemUrl: "" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const result = await searchIchibaItems(AUTH, { keyword: "x" });
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
