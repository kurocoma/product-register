import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// --- 依存モジュールを全てモック（live API / DB / sharp を呼ばない）---
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/rakuten/credentials", () => ({ getRakutenCredentialsFromEnv: vi.fn() }));
vi.mock("@/lib/rakuten/item-client", () => ({
  getItem: vi.fn(),
  searchManageNumberBySku: vi.fn(),
}));
vi.mock("@/lib/converters/rakuten-item-parser", () => ({
  parseRakutenItem: vi.fn(),
  parseRakutenVariants: vi.fn(),
}));
vi.mock("@/lib/converters/mall-import", () => ({ buildImportedProduct: vi.fn() }));
vi.mock("@/lib/product/category-mapping", () => ({ fetchYahooCategoryMapping: vi.fn() }));
vi.mock("@/lib/product/repository", () => ({ upsertProduct: vi.fn() }));
vi.mock("@/lib/yahoo/auth", () => ({ getYahooConfig: vi.fn(), getYahooAccessToken: vi.fn() }));
vi.mock("@/lib/yahoo/item-mapper", () => ({
  buildYahooEditItemParams: vi.fn(),
  validateEditItemParams: vi.fn(),
}));
vi.mock("@/lib/yahoo/item-client", () => ({ editItem: vi.fn() }));
vi.mock("@/lib/history/recorder", () => ({ recordHistory: vi.fn() }));
// 画像系（dry-run では呼ばれないが import 解決のためモック）
vi.mock("@/lib/yahoo/lib-path", () => ({
  buildYahooLibFileName: vi.fn(() => ({ fileName: "x.jpg" })),
  validateYahooFileName: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/lib/image/process", () => ({ processForCabinet: vi.fn(async () => Buffer.from("")) }));
vi.mock("@/lib/yahoo/lib-image-client", () => ({ uploadLibImage: vi.fn(async () => ({ ok: true })) }));

import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem, searchManageNumberBySku } from "@/lib/rakuten/item-client";
import { parseRakutenItem, parseRakutenVariants } from "@/lib/converters/rakuten-item-parser";
import { buildImportedProduct } from "@/lib/converters/mall-import";
import { fetchYahooCategoryMapping } from "@/lib/product/category-mapping";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { buildYahooEditItemParams, validateEditItemParams } from "@/lib/yahoo/item-mapper";

/** auth + products テーブル照会だけ満たす最小 Supabase スタブ。 */
function makeSupabase(user: { id: string } | null) {
  const builder: Record<string, unknown> = {};
  builder.from = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.limit = vi.fn(async () => ({ data: [] })); // 既存なし → existed=false
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    ...builder,
  };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/migrate/rakuten-to-yahoo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as Mock).mockResolvedValue(makeSupabase({ id: "user-1" }));
  (getRakutenCredentialsFromEnv as Mock).mockReturnValue({ serviceSecret: "s", licenseKey: "l" });
  (getYahooConfig as Mock).mockReturnValue({ sellerId: "seller", clientId: "c", clientSecret: "cs", refreshToken: "rt" });
  (getYahooAccessToken as Mock).mockResolvedValue("token-xyz");
  (getItem as Mock).mockResolvedValue({ exists: true, status: 200, json: { genreId: "G1" }, raw: "{}" });
  (searchManageNumberBySku as Mock).mockResolvedValue(null);
  (parseRakutenItem as Mock).mockReturnValue({});
  (parseRakutenVariants as Mock).mockReturnValue([]); // 単一SKU
  (buildImportedProduct as Mock).mockReturnValue({
    ok: true,
    product: { ne_code: "NE-1", mall_category_id: "G1", yahoo_grouping_enabled: false, image_count: 1 },
    neCode: "NE-1",
  });
  (fetchYahooCategoryMapping as Mock).mockResolvedValue({
    yahoo_category_id: "13457",
    yahoo_category_name: "日本酒",
    yahoo_path: "food",
    confidence: "high",
  });
  (buildYahooEditItemParams as Mock).mockReturnValue({
    seller_id: "seller",
    item_code: "NE-1",
    path: "food",
    name: "X",
    product_category: "13457",
    price: "1000",
  });
  (validateEditItemParams as Mock).mockReturnValue({ ok: true });
});

describe("POST /api/migrate/rakuten-to-yahoo", () => {
  it("未ログインは 401 (AC: 認証必須)", async () => {
    (createClient as Mock).mockResolvedValue(makeSupabase(null));
    const res = await POST(makeRequest({ manageNumbers: "abc-1" }));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.ok).toBe(false);
  });

  it("dry-run(既定)では getYahooAccessToken を呼ばない (AC-005)", async () => {
    const res = await POST(makeRequest({ manageNumbers: "abc-1" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dryRun).toBe(true);
    expect(getYahooAccessToken).not.toHaveBeenCalled();
  });

  it("AC-001: results(各 manageNumber/step/ok/status) + summary + invalid + duplicatesRemoved を返す", async () => {
    // abc-1 重複1 / abc-2 / 不正トークン1
    const res = await POST(makeRequest({ manageNumbers: "abc-1\nabc-1\nabc-2\nbad token!" }));
    expect(res.status).toBe(200);
    const j = await res.json();

    expect(j.ok).toBe(true);
    expect(Array.isArray(j.results)).toBe(true);
    expect(j.results).toHaveLength(2); // valid 2件のみ実行
    for (const r of j.results) {
      expect(r).toHaveProperty("manageNumber");
      expect(r).toHaveProperty("step");
      expect(r).toHaveProperty("ok");
      expect(r).toHaveProperty("status");
    }
    // dry-run の移行可は migrated に数える
    expect(j.summary).toMatchObject({ total: 2, migrated: 2, requiresManual: 0, failed: 0 });
    expect(j.duplicatesRemoved).toBe(1);
    expect(Array.isArray(j.invalid)).toBe(true);
    expect(j.invalid).toHaveLength(1);
    expect(j.invalid[0].raw).toBe("bad token!");
  });

  it("SKU検索フォールバック: getItem 不在→searchManageNumberBySku→実管理番号で再 getItem", async () => {
    (getItem as Mock).mockImplementation(async (_cred: unknown, mn: string) => {
      if (mn === "real-mn") return { exists: true, status: 200, json: { genreId: "G1" }, raw: "{}" };
      return { exists: false, status: 404, json: null, raw: "" };
    });
    (searchManageNumberBySku as Mock).mockResolvedValue("real-mn");

    const res = await POST(makeRequest({ manageNumbers: "skucode" }));
    expect(res.status).toBe(200);
    const j = await res.json();

    expect(searchManageNumberBySku).toHaveBeenCalledWith(
      expect.anything(),
      "skucode",
    );
    expect((getItem as Mock).mock.calls.length).toBe(2); // 入力SKU → 実管理番号
    expect(j.results[0].status).toBe("migrate"); // フォールバックで解決し移行可
    expect(j.results[0].manageNumber).toBe("skucode"); // 結果には入力値を保持
  });
});
