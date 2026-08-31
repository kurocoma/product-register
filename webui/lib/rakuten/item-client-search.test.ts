import { describe, it, expect, afterEach, vi } from "vitest";
import { searchItemsByTitle } from "./item-client";
import type { RakutenCredentials } from "./cabinet-client";

/** 260901修正依頼-1: 楽天 items.search title 検索クライアント（実 fetch はスタブ）。 */

const cred: RakutenCredentials = { serviceSecret: "sec", licenseKey: "key" };

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

describe("searchItemsByTitle", () => {
  it("results[].item から manageNumber / title / hideItem を取り出す", async () => {
    stubFetch(
      200,
      JSON.stringify({
        numFound: 2,
        results: [
          { item: { manageNumber: "buta-miso", title: "味噌 豚肉みそ 140g", hideItem: false } },
          { item: { manageNumber: "buta-miso2", title: "味噌 豚肉みそ 140g×12", hideItem: true } },
        ],
      }),
    );
    const r = await searchItemsByTitle(cred, "豚肉みそ");
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([
      { manageNumber: "buta-miso", title: "味噌 豚肉みそ 140g", hideItem: false },
      { manageNumber: "buta-miso2", title: "味噌 豚肉みそ 140g×12", hideItem: true },
    ]);
  });

  it("title を URL エンコードし hits 上限を付けて送る", async () => {
    const mock = stubFetch(200, JSON.stringify({ results: [] }));
    await searchItemsByTitle(cred, "豚肉みそ", 500);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain(`title=${encodeURIComponent("豚肉みそ")}`);
    expect(url).toContain("hits=100"); // 上限クランプ
  });

  it("manageNumber の無い結果は除外する", async () => {
    stubFetch(200, JSON.stringify({ results: [{ item: { title: "壊れ" } }, {}] }));
    const r = await searchItemsByTitle(cred, "x");
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([]);
  });

  it("HTTP エラーは ok=false + 整形済みメッセージ", async () => {
    stubFetch(401, JSON.stringify({ errors: [{ code: "AA01", message: "認証エラー" }] }));
    const r = await searchItemsByTitle(cred, "x");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("AA01");
  });
});
