import { describe, it, expect, afterEach, vi } from "vitest";
import { searchStoreItemsByName } from "./item-search-client";

/** 260901修正依頼-1: Yahoo 公開 itemSearch v3 クライアント（実 fetch はスタブ）。 */

function stubFetch(status: number, body: string) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    void input; // 呼び出しURLの検証は mock.calls 経由（引数型は fetch 互換にする）
    return new Response(body, { status });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchStoreItemsByName", () => {
  it("hits[].code の '{sellerId}_' 接頭辞を剥がして itemCode にする", async () => {
    stubFetch(
      200,
      JSON.stringify({
        totalResultsAvailable: 2,
        hits: [
          { code: "mystore_r004-2205-1", name: "クラフトコーラ 300ml", price: 1065 },
          { code: "mystore_r004-2205-3", name: "クラフトコーラ 300ml 3本", price: 3402 },
        ],
      }),
    );
    const r = await searchStoreItemsByName("appid", "mystore", "クラフトコーラ");
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([
      { itemCode: "r004-2205-1", name: "クラフトコーラ 300ml", price: 1065 },
      { itemCode: "r004-2205-3", name: "クラフトコーラ 300ml 3本", price: 3402 },
    ]);
  });

  it("他ストアの code（接頭辞不一致）は候補から除外する", async () => {
    stubFetch(
      200,
      JSON.stringify({ hits: [{ code: "otherstore_x-1", name: "他店商品", price: 100 }] }),
    );
    const r = await searchStoreItemsByName("appid", "mystore", "商品");
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it("appid / seller_id / query をURLエンコードして送る", async () => {
    const mock = stubFetch(200, JSON.stringify({ hits: [] }));
    await searchStoreItemsByName("app id", "mystore", "もろみ酢");
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain("appid=app%20id");
    expect(url).toContain("seller_id=mystore");
    expect(url).toContain(`query=${encodeURIComponent("もろみ酢")}`);
  });

  it("HTTP エラーは ok=false + メッセージ", async () => {
    stubFetch(403, "Forbidden");
    const r = await searchStoreItemsByName("appid", "mystore", "商品");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("HTTP 403");
    expect(r.hits).toEqual([]);
  });

  it("JSON でない応答は ok=false（解析失敗）", async () => {
    stubFetch(200, "<xml>not json</xml>");
    const r = await searchStoreItemsByName("appid", "mystore", "商品");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("解析に失敗");
  });
});
