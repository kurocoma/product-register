import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getYahooAccessToken, _clearYahooTokenCache, type YahooConfig } from "./auth";

const cfgA: YahooConfig = {
  clientId: "cid-A",
  clientSecret: "sec-A",
  refreshToken: "rt-A",
  sellerId: "shop-a",
};
const cfgB: YahooConfig = {
  clientId: "cid-B",
  clientSecret: "sec-B",
  refreshToken: "rt-B",
  sellerId: "shop-b",
};

function tokenResponse(token: string, expiresIn = 3600): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: token, expires_in: expiresIn }),
  } as unknown as Response;
}

/** トークンキャッシュの再利用と、資格情報(テナント)ごとの分離を固定する。
 * 一括登録では商品ごとに getYahooAccessToken が呼ばれるため、
 * 「初回だけ取得・以後キャッシュ」かつ「他テナントのトークンを返さない」ことが要。 */
describe("getYahooAccessToken — 資格情報ごとのトークンキャッシュ", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    _clearYahooTokenCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("同一 cfg の連続呼び出しは1回だけ取得しキャッシュを再利用する（一括登録の per-item 呼び出し）", async () => {
    fetchMock.mockResolvedValue(tokenResponse("tok-A"));
    const t1 = await getYahooAccessToken(cfgA);
    const t2 = await getYahooAccessToken(cfgA);
    const t3 = await getYahooAccessToken(cfgA);
    expect([t1, t2, t3]).toEqual(["tok-A", "tok-A", "tok-A"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("異なる cfg は別々に取得し、他テナントのトークンを返さない", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-A"))
      .mockResolvedValueOnce(tokenResponse("tok-B"));
    const tA = await getYahooAccessToken(cfgA);
    const tB = await getYahooAccessToken(cfgB);
    expect(tA).toBe("tok-A");
    expect(tB).toBe("tok-B"); // 単一スロットのキャッシュだと tok-A が返ってしまう（取り違え）
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("有効期限の60秒前を過ぎたら再取得する", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1", 1)) // 実質即失効 → 次回は必ず再取得
      .mockResolvedValueOnce(tokenResponse("tok-2"));
    const t1 = await getYahooAccessToken(cfgA);
    const t2 = await getYahooAccessToken(cfgA);
    expect(t1).toBe("tok-1");
    expect(t2).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
