import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// --- 依存モジュールを全てモック（live API / DB を呼ばない）---
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/rakuten", () => ({
  getRakutenCredentialsFromEnv: vi.fn(),
  searchItemsByTitle: vi.fn(),
}));
vi.mock("@/lib/yahoo", () => ({
  getYahooConfig: vi.fn(),
  searchStoreItemsByName: vi.fn(),
}));
vi.mock("@/lib/shopify", () => ({
  getShopifyConfig: vi.fn(),
  searchProductsByTitle: vi.fn(),
}));

import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv, searchItemsByTitle } from "@/lib/rakuten";
import { getYahooConfig, searchStoreItemsByName } from "@/lib/yahoo";
import { getShopifyConfig, searchProductsByTitle } from "@/lib/shopify";

/** 260901修正依頼-1: 商品名検索ルート（モール共通形への正規化と認証ガード）。 */

function makeSupabase(user: { id: string } | null) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}

const call = (mall: string, q?: string) =>
  GET(new Request(`http://localhost/api/import/${mall}/search${q != null ? `?q=${encodeURIComponent(q)}` : ""}`), {
    params: Promise.resolve({ mall }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as Mock).mockResolvedValue(makeSupabase({ id: "user-1" }));
  (getRakutenCredentialsFromEnv as Mock).mockReturnValue({ serviceSecret: "s", licenseKey: "k" });
  (getYahooConfig as Mock).mockReturnValue({ clientId: "cid", clientSecret: "cs", refreshToken: "rt", sellerId: "mystore" });
  (getShopifyConfig as Mock).mockReturnValue({ shop: "x" });
});

describe("GET /api/import/[mall]/search", () => {
  it("未ログインは 401", async () => {
    (createClient as Mock).mockResolvedValue(makeSupabase(null));
    const res = await call("rakuten", "みそ");
    expect(res.status).toBe(401);
  });

  it("不正モールは 400", async () => {
    const res = await call("amazon", "みそ");
    expect(res.status).toBe(400);
  });

  it("q なしは 400", async () => {
    const res = await call("rakuten");
    expect(res.status).toBe(400);
  });

  it("楽天: manageNumber を code に正規化し、倉庫商品は note を付ける", async () => {
    (searchItemsByTitle as Mock).mockResolvedValue({
      ok: true,
      results: [
        { manageNumber: "buta-miso", title: "味噌 豚肉みそ 140g", hideItem: false },
        { manageNumber: "buta-miso2", title: "味噌 豚肉みそ 140g×12", hideItem: true },
      ],
    });
    const res = await call("rakuten", "豚肉みそ");
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.results).toEqual([
      { code: "buta-miso", name: "味噌 豚肉みそ 140g" },
      { code: "buta-miso2", name: "味噌 豚肉みそ 140g×12", note: "倉庫（非公開）" },
    ]);
  });

  it("Yahoo: itemCode を code に正規化し、公開商品のみの hint を返す", async () => {
    (searchStoreItemsByName as Mock).mockResolvedValue({
      ok: true,
      hits: [{ itemCode: "r004-2205-1", name: "クラフトコーラ", price: 1065 }],
    });
    const res = await call("yahoo", "コーラ");
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.results).toEqual([{ code: "r004-2205-1", name: "クラフトコーラ", note: "税込1,065円" }]);
    expect(j.hint).toContain("公開中");
    // OAuth Client ID を appid として渡す（実測 2026-09-01 で確認済みの流用）
    expect((searchStoreItemsByName as Mock).mock.calls[0].slice(0, 2)).toEqual(["cid", "mystore"]);
  });

  it("Shopify: 数値IDを code に正規化し、非公開ステータスは note を付ける", async () => {
    (searchProductsByTitle as Mock).mockResolvedValue({
      ok: true,
      hits: [
        { gid: "gid://shopify/Product/1", numericId: "1", title: "くりま 黒糖", status: "ACTIVE" },
        { gid: "gid://shopify/Product/2", numericId: "2", title: "くりま 塩", status: "DRAFT" },
      ],
    });
    const res = await call("shopify", "くりま");
    const j = await res.json();
    expect(j.results).toEqual([
      { code: "1", name: "くりま 黒糖" },
      { code: "2", name: "くりま 塩", note: "下書き" },
    ]);
  });

  it("モール検索の失敗は 502 + 理由", async () => {
    (searchItemsByTitle as Mock).mockResolvedValue({ ok: false, message: "認証エラー", results: [] });
    const res = await call("rakuten", "みそ");
    const j = await res.json();
    expect(res.status).toBe(502);
    expect(j.error).toContain("認証エラー");
  });
});
