import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// --- 純ロジック層はモックしつつ runItems だけスパイ（実挙動維持）---
// route が runItems に渡す options.delayMs（レート制御 / AC-H01）を検証する。
vi.mock("@/lib/migrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/migrate")>();
  return { ...actual, runItems: vi.fn(actual.runItems) };
});

// --- live API / DB / sharp を呼ばないよう依存をモック（route.test.ts の構成を踏襲）---
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
vi.mock("@/lib/yahoo/lib-path", () => ({
  buildYahooLibFileName: vi.fn(() => ({ fileName: "x.jpg" })),
  validateYahooFileName: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/lib/image/process", () => ({ processForCabinet: vi.fn(async () => Buffer.from("")) }));
vi.mock("@/lib/yahoo/lib-image-client", () => ({ uploadLibImage: vi.fn(async () => ({ ok: true })) }));

import { POST } from "./route";
import { runItems } from "@/lib/migrate";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem, searchManageNumberBySku } from "@/lib/rakuten/item-client";
import { parseRakutenItem, parseRakutenVariants } from "@/lib/converters/rakuten-item-parser";
import { buildImportedProduct } from "@/lib/converters/mall-import";
import { fetchYahooCategoryMapping } from "@/lib/product/category-mapping";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { buildYahooEditItemParams, validateEditItemParams } from "@/lib/yahoo/item-mapper";

function makeSupabase(user: { id: string } | null) {
  const builder: Record<string, unknown> = {};
  builder.from = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.limit = vi.fn(async () => ({ data: [] })); // 既存なし
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
  (parseRakutenVariants as Mock).mockReturnValue([]);
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

describe("POST /api/migrate/rakuten-to-yahoo — レート制御 / 大量入力ガード", () => {
  it("AC-H01: delayMs 未指定なら runItems が安全既定 delayMs=300 で呼ばれレスポンスに反映", async () => {
    const res = await POST(makeRequest({ manageNumbers: "abc-1" }));
    expect(res.status).toBe(200);

    expect(runItems).toHaveBeenCalledTimes(1);
    const opts = (runItems as Mock).mock.calls[0][2];
    expect(opts.delayMs).toBe(300);
    expect(opts.continueOnError).toBe(true);

    const j = await res.json();
    expect(j.delayMs).toBe(300);
  });

  it("AC-H01: body.delayMs=0 なら runItems に delayMs=0 が渡る（無効化可・上書き）", async () => {
    const res = await POST(makeRequest({ manageNumbers: "abc-1", delayMs: 0 }));
    expect(res.status).toBe(200);

    const opts = (runItems as Mock).mock.calls[0][2];
    expect(opts.delayMs).toBe(0);

    const j = await res.json();
    expect(j.delayMs).toBe(0);
  });

  it("AC-H01: 不正な delayMs（負値/非数）は安全既定 300 に丸める", async () => {
    await POST(makeRequest({ manageNumbers: "abc-1", delayMs: -5 }));
    expect((runItems as Mock).mock.calls[0][2].delayMs).toBe(300);
  });

  it("AC-H04: valid 件数が上限(200)超過なら 400 + 件数メッセージで拒否し runItems を呼ばない", async () => {
    const many = Array.from({ length: 201 }, (_, i) => `code-${i + 1}`);
    const res = await POST(makeRequest({ manageNumbers: many }));
    expect(res.status).toBe(400);

    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.count).toBe(201);
    expect(j.error).toContain("201");
    expect(j.error).toContain("200");
    expect(runItems).not.toHaveBeenCalled();
  });

  it("AC-H04: 上限以内(200件)は通常処理され runItems が呼ばれる（delayMs=0で実時間消費なし）", async () => {
    const exactly = Array.from({ length: 200 }, (_, i) => `code-${i + 1}`);
    const res = await POST(makeRequest({ manageNumbers: exactly, delayMs: 0 }));
    expect(res.status).toBe(200);
    expect(runItems).toHaveBeenCalledTimes(1);
  });
});
