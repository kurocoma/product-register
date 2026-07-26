import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listStCategories, editStCategory, ensureTopLevelStCategory } from "./st-category-client";

// ストアカテゴリAPI クライアントの単体テスト（実通信なし）。
// 仕様: docs/Yahoo/06-カテゴリ・ブランド管理.md §4-5。

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
beforeEach(() => { vi.clearAllMocks(); });

function mockResponse(body: string, status = 200) {
  return { status, text: async () => body } as unknown as Response;
}

const LIST_XML = `<?xml version="1.0"?><ResultSet>
<Result><PageKey>k-1</PageKey><Name><![CDATA[ダイエット、健康]]></Name><Display>1</Display><SortOrder>1</SortOrder></Result>
<Result><PageKey>k-2</PageKey><Name><![CDATA[しまのや]]></Name><Display>1</Display><SortOrder>2</SortOrder></Result>
</ResultSet>`;

describe("listStCategories", () => {
  it("Result 要素を配列へパースする", async () => {
    global.fetch = vi.fn(async () => mockResponse(LIST_XML)) as unknown as typeof fetch;
    const r = await listStCategories("tok", "seller");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.categories).toHaveLength(2);
    expect(r.categories[1]).toEqual({ pageKey: "k-2", name: "しまのや", display: "1", sortOrder: "2" });
  });

  it("Error 要素があれば ok:false（コードとメッセージを返す）", async () => {
    global.fetch = vi.fn(async () => mockResponse(`<ResultSet><Error><Code>sc-02002</Code><Message>page_keyが存在しません</Message></Error></ResultSet>`, 400)) as unknown as typeof fetch;
    const r = await listStCategories("tok", "seller", "bad");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("sc-02002");
  });

  it("page_key を指定すると子カテゴリ一覧のクエリになる", async () => {
    const spy = vi.fn(async () => mockResponse(LIST_XML));
    global.fetch = spy as unknown as typeof fetch;
    await listStCategories("tok", "seller", "k-1");
    expect(String(spy.mock.calls[0][0])).toContain("page_key=k-1");
  });
});

describe("editStCategory", () => {
  it("page_key 未指定なら新規作成として送り、採番された PageKey を返す", async () => {
    const spy = vi.fn(async () => mockResponse(`<ResultSet><Status>OK</Status><PageKey>new-1</PageKey></ResultSet>`));
    global.fetch = spy as unknown as typeof fetch;
    const r = await editStCategory("tok", "seller", { name: "しまのや" });
    expect(r).toEqual({ ok: true, pageKey: "new-1" });
    const body = String((spy.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("seller_id=seller");
    expect(body).not.toContain("page_key=");
  });

  it("同名カテゴリ重複(sc-01005)は ok:false", async () => {
    global.fetch = vi.fn(async () => mockResponse(`<ResultSet><Error><Code>sc-01005</Code><Message>同一階層に同名カテゴリが存在します</Message></Error></ResultSet>`, 400)) as unknown as typeof fetch;
    const r = await editStCategory("tok", "seller", { name: "しまのや" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("sc-01005");
  });
});

describe("ensureTopLevelStCategory", () => {
  it("既に存在すれば作成せずそのページキーを返す", async () => {
    const spy = vi.fn(async () => mockResponse(LIST_XML));
    global.fetch = spy as unknown as typeof fetch;
    const r = await ensureTopLevelStCategory("tok", "seller", "しまのや");
    expect(r).toEqual({ ok: true, pageKey: "k-2", created: false });
    expect(spy).toHaveBeenCalledTimes(1); // 作成APIは呼ばない
  });

  it("無ければ第1階層に作成する", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return calls.length === 1
        ? mockResponse(`<ResultSet><Result><PageKey>k-1</PageKey><Name>他</Name></Result></ResultSet>`)
        : mockResponse(`<ResultSet><Status>OK</Status><PageKey>k-9</PageKey></ResultSet>`);
    }) as unknown as typeof fetch;
    const r = await ensureTopLevelStCategory("tok", "seller", "しまのや");
    expect(r).toEqual({ ok: true, pageKey: "k-9", created: true });
    expect(calls[1]).toContain("editStCategory");
  });
});
