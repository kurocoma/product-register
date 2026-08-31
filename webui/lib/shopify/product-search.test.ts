import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

vi.mock("./graphql-client", () => ({
  shopifyGraphQL: vi.fn(),
  formatUserErrors: vi.fn(() => ""),
}));

import { searchProductsByTitle } from "./product-client";
import { shopifyGraphQL } from "./graphql-client";
import type { ShopifyConfig } from "./auth";

/** 260901修正依頼-1: Shopify 商品名検索（products query はモック）。 */

const cfg = { shop: "x", clientId: "c", clientSecret: "s" } as unknown as ShopifyConfig;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchProductsByTitle", () => {
  it("products(query:'title:*…*') を投げ、gid/数値ID/title/status を返す", async () => {
    (shopifyGraphQL as Mock).mockResolvedValue({
      ok: true,
      message: "",
      data: {
        products: {
          edges: [
            { node: { id: "gid://shopify/Product/123", title: "くりま 黒糖", status: "ACTIVE" } },
            { node: { id: "gid://shopify/Product/456", title: "くりま 塩", status: "DRAFT" } },
          ],
        },
      },
    });
    const r = await searchProductsByTitle(cfg, "くりま");
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([
      { gid: "gid://shopify/Product/123", numericId: "123", title: "くりま 黒糖", status: "ACTIVE" },
      { gid: "gid://shopify/Product/456", numericId: "456", title: "くりま 塩", status: "DRAFT" },
    ]);
    const vars = (shopifyGraphQL as Mock).mock.calls[0][2];
    expect(vars.query).toBe("title:*くりま*");
  });

  it("引用符・バックスラッシュは除去して検索構文の崩れを防ぐ", async () => {
    (shopifyGraphQL as Mock).mockResolvedValue({ ok: true, message: "", data: { products: { edges: [] } } });
    await searchProductsByTitle(cfg, `a"b\\c`);
    const vars = (shopifyGraphQL as Mock).mock.calls[0][2];
    expect(vars.query).toBe("title:*a b c*");
  });

  it("GraphQL エラーは ok=false + メッセージ", async () => {
    (shopifyGraphQL as Mock).mockResolvedValue({ ok: false, message: "ACCESS_DENIED", data: null });
    const r = await searchProductsByTitle(cfg, "x");
    expect(r.ok).toBe(false);
    expect(r.message).toBe("ACCESS_DENIED");
    expect(r.hits).toEqual([]);
  });
});
