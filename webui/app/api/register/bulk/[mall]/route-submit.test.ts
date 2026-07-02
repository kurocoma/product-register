import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// --- 依存モジュールを全てモック（live API / DB を呼ばない）---
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/product/repository", () => ({
  getProduct: vi.fn(),
  dbRowToProductInput: vi.fn(),
}));
vi.mock("@/lib/rakuten/credentials", () => ({ getRakutenCredentialsFromEnv: vi.fn() }));
vi.mock("@/lib/yahoo/auth", () => ({ getYahooConfig: vi.fn() }));
vi.mock("@/lib/register/rakuten-register-service", () => ({
  dryRunRakutenRegister: vi.fn(),
  commitRakutenRegister: vi.fn(),
}));
vi.mock("@/lib/register/yahoo-register-service", () => ({
  dryRunYahooRegister: vi.fn(),
  commitYahooRegister: vi.fn(),
  reserveYahooPublish: vi.fn(),
}));

import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { getProduct } from "@/lib/product/repository";
import { getYahooConfig } from "@/lib/yahoo/auth";
import { reserveYahooPublish } from "@/lib/register/yahoo-register-service";

function makeSupabase(user: { id: string } | null) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}

function makeRequest(mall: string, body: unknown) {
  return new Request(`http://localhost/api/register/bulk/${mall}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const call = (mall: string, body: unknown) =>
  POST(makeRequest(mall, body), { params: Promise.resolve({ mall }) });

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as Mock).mockResolvedValue(makeSupabase({ id: "user-1" }));
  (getYahooConfig as Mock).mockReturnValue({
    clientId: "c",
    clientSecret: "cs",
    refreshToken: "rt",
    sellerId: "seller",
  });
  (reserveYahooPublish as Mock).mockResolvedValue({ ok: true, message: "反映を予約しました" });
});

describe("POST /api/register/bulk/yahoo { action: 'submit' }（反映予約のみの薄い口）", () => {
  it("商品登録なしで reservePublish を1回だけ呼び、結果を返す", async () => {
    const res = await call("yahoo", { action: "submit" });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toEqual({ ok: true, mall: "yahoo", submitted: true, submitMessage: "反映を予約しました" });
    expect(reserveYahooPublish).toHaveBeenCalledTimes(1);
    // 予約のみの口は商品処理をしない（ids 不要 = 登録成否から構造的に独立）
    expect(getProduct).not.toHaveBeenCalled();
  });

  it("予約失敗は submitted=false + メッセージで返す（HTTP 200）", async () => {
    (reserveYahooPublish as Mock).mockResolvedValue({ ok: false, message: "認証エラー" });
    const res = await call("yahoo", { action: "submit" });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.submitted).toBe(false);
    expect(j.submitMessage).toBe("認証エラー");
  });

  it("楽天に action:submit は 400（反映予約はYahooのみ）", async () => {
    const res = await call("rakuten", { action: "submit" });
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.ok).toBe(false);
    expect(reserveYahooPublish).not.toHaveBeenCalled();
  });

  it("未ログインは 401", async () => {
    (createClient as Mock).mockResolvedValue(makeSupabase(null));
    const res = await call("yahoo", { action: "submit" });
    expect(res.status).toBe(401);
    expect(reserveYahooPublish).not.toHaveBeenCalled();
  });

  it("Yahoo 認証情報が未設定なら 500", async () => {
    (getYahooConfig as Mock).mockReturnValue(null);
    const res = await call("yahoo", { action: "submit" });
    expect(res.status).toBe(500);
    expect(reserveYahooPublish).not.toHaveBeenCalled();
  });

  it("action なし + ids なしは従来どおり 400（既存の入力検証を壊さない）", async () => {
    const res = await call("yahoo", {});
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.error).toContain("対象商品");
  });
});
