import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct } from "../product/schema";
import type { ProductRow } from "../product/repository";
import type { YahooConfig } from "@/lib/yahoo/auth";
import { commitYahooRegister, type YahooRegisterDeps } from "./yahoo-register-service";
import { collectImageSources, isYahooImagePropagationError } from "./yahoo-image-sync";

/** 260901修正依頼-2: Yahoo登録時の画像自動転送（it-14091 対策）のユニットテスト。
 * 実送信しない注入 deps で、A1(転送→登録の順序)・A2(成功indexのみ参照)・A4(1回リトライ)を検証する。 */

const supabase = {} as unknown as SupabaseClient;
const cfg: YahooConfig = { clientId: "cid", clientSecret: "csec", refreshToken: "rt", sellerId: "test-store" };

type SyncCall = { sellerId: string; imageCode: string };

function imageDeps(opts: {
  uploaded?: number[];
  syncOk?: boolean;
  syncError?: string;
  editFailures?: { ok: false; message: string; warnings: string[]; errors: string[] }[];
} = {}) {
  const record = {
    syncCalls: [] as SyncCall[],
    editParams: [] as Record<string, string>[],
    sleeps: [] as number[],
  };
  const failures = [...(opts.editFailures ?? [])];
  const deps: YahooRegisterDeps = {
    getAccessToken: async () => "tok",
    getItem: async () => ({ exists: false, raw: "" }),
    editItem: async (_t, params) => {
      record.editParams.push(params);
      const f = failures.shift();
      return f ?? { ok: true, warnings: [] };
    },
    setStock: async () => ({ ok: true, message: "" }),
    reservePublish: async () => ({ ok: true, message: "OK" }),
    upsertProduct: async () => ({}) as ProductRow,
    syncImages: async (_t, sellerId, _p, imageCode) => {
      record.syncCalls.push({ sellerId, imageCode });
      return {
        ok: opts.syncOk ?? true,
        error: opts.syncError,
        uploaded: opts.uploaded ?? [1, 2],
      };
    },
    buildImageUrls: (imageCode, indices, sellerId) => `${sellerId}|${imageCode}|${indices.join(",")}`,
    sleep: async (ms) => {
      record.sleeps.push(ms);
    },
  };
  return { deps, record };
}

/** 楽天取込商品相当: image_url_N が楽天CDNの実URLのまま。 */
function importedProduct() {
  return makeProduct({
    image_count: 2,
    image_url_1: "https://image.rakuten.co.jp/x/cabinet/a.jpg",
    image_url_2: "https://image.rakuten.co.jp/x/cabinet/b.jpg",
  });
}

describe("yahoo-image-sync: 純関数", () => {
  it("collectImageSources は image_url_1..image_count の非空分を index 付きで返す", () => {
    const p = makeProduct({ image_count: 3, image_url_1: "https://a/1.jpg", image_url_3: "https://a/3.jpg" });
    expect(collectImageSources(p)).toEqual([
      { index: 1, url: "https://a/1.jpg" },
      { index: 3, url: "https://a/3.jpg" },
    ]);
  });

  it("collectImageSources は image_count を超える枠を見ない", () => {
    const p = makeProduct({ image_count: 1, image_url_1: "https://a/1.jpg", image_url_2: "https://a/2.jpg" });
    expect(collectImageSources(p)).toEqual([{ index: 1, url: "https://a/1.jpg" }]);
  });

  it("isYahooImagePropagationError は it-14091 / im-02005 のみ true", () => {
    expect(
      isYahooImagePropagationError({ ok: false, message: "it-14091: 追加画像への商品紐づけ…", warnings: [], errors: [] }),
    ).toBe(true);
    expect(
      isYahooImagePropagationError({ ok: false, message: "NG", warnings: [], errors: ["im-02005: 画像未存在"] }),
    ).toBe(true);
    expect(isYahooImagePropagationError({ ok: false, message: "Code=px-04102", warnings: [], errors: [] })).toBe(false);
    expect(isYahooImagePropagationError({ ok: true, warnings: [] })).toBe(false);
  });
});

describe("commitYahooRegister: 画像自動転送（A1/A2）", () => {
  it("取込画像URLがあれば editItem の前に転送し、成功indexのみで item_image_urls を再構築する", async () => {
    const { deps, record } = imageDeps({ uploaded: [1, 2] });
    const r = await commitYahooRegister(supabase, cfg, importedProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    expect(record.syncCalls).toEqual([{ sellerId: "test-store", imageCode: "t002-2542-1" }]);
    expect(record.editParams[0].item_image_urls).toBe("test-store|t002-2542-1|1,2");
  });

  it("部分失敗（成功1件以上）は登録を続行し、注意を warnings へ載せる", async () => {
    const { deps, record } = imageDeps({ uploaded: [2], syncOk: false, syncError: "#1: 画像取得失敗 (HTTP 404)" });
    const r = await commitYahooRegister(supabase, cfg, importedProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(record.editParams[0].item_image_urls).toBe("test-store|t002-2542-1|2");
    expect(r.warnings.join(" ")).toContain("画像転送に注意");
    expect(r.warnings.join(" ")).toContain("HTTP 404");
  });

  it("全件失敗なら editItem を呼ばず中止する（it-14091 での全体失敗を防ぐ）", async () => {
    const { deps, record } = imageDeps({ uploaded: [], syncOk: false, syncError: "#1: 画像取得失敗 / #2: 画像取得失敗" });
    const r = await commitYahooRegister(supabase, cfg, importedProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("api");
    expect(r.error).toContain("登録を中止");
    expect(record.editParams.length).toBe(0);
  });

  it("転送元URL(image_url_N)が無い商品は転送せず従来どおり登録する", async () => {
    const { deps, record } = imageDeps();
    const r = await commitYahooRegister(supabase, cfg, makeProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    expect(record.syncCalls.length).toBe(0);
    // converter が組んだ従来の item_image_urls（image_count=3 の連番）を上書きしない
    expect(record.editParams[0].item_image_urls).toContain("t002-2542-1.jpg");
  });

  it("syncImages 未注入（後方互換）の deps では転送も上書きもしない", async () => {
    const { deps, record } = imageDeps();
    delete deps.syncImages;
    const r = await commitYahooRegister(supabase, cfg, importedProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    expect(record.editParams[0].item_image_urls).toContain("t002-2542-1.jpg");
    expect(record.editParams[0].item_image_urls).not.toContain("test-store|");
  });
});

describe("commitYahooRegister: it-14091 リトライ（A4）", () => {
  it("it-14091 は短い待機後に1回だけリトライし、2回目成功なら ok", async () => {
    const { deps, record } = imageDeps({
      editFailures: [{ ok: false, message: "it-14091: 追加画像への商品紐づけ登録/解除が行えませんでした。", warnings: [], errors: [] }],
    });
    const r = await commitYahooRegister(supabase, cfg, importedProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    expect(record.editParams.length).toBe(2);
    expect(record.sleeps).toEqual([1500]);
  });

  it("画像と無関係な失敗はリトライしない", async () => {
    const { deps, record } = imageDeps({
      editFailures: [{ ok: false, message: "Code=px-04102", warnings: [], errors: [] }],
    });
    const r = await commitYahooRegister(supabase, cfg, importedProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    expect(record.editParams.length).toBe(1);
    expect(record.sleeps).toEqual([]);
  });
});

describe("commitYahooRegister: 統合商品（SKU分割）の画像転送", () => {
  it("SKU ごとに、そのSKUの item_image_urls が参照するコード名で転送する", async () => {
    const { deps, record } = imageDeps({ uploaded: [1] });
    const p = makeProduct({
      image_count: 1,
      image_url_1: "https://image.rakuten.co.jp/x/cabinet/a.jpg",
      variants: [1, 6].map((q) => ({
        sku_manage_number: `a009-4916-${q}`,
        ne_code: `a009-4916-${q}`,
        jan_code: "4955028002542",
        selling_price: 1000 * q,
        tax_rate: 10,
        quantity: q,
        variation_value: `${q}本`,
        shipping_type: "送料別",
      })),
    });
    const r = await commitYahooRegister(supabase, cfg, p, "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    expect(record.syncCalls.map((c) => c.imageCode)).toEqual(["a009-4916-1", "a009-4916-6"]);
    expect(record.editParams.map((ep) => ep.item_image_urls)).toEqual([
      "test-store|a009-4916-1|1",
      "test-store|a009-4916-6|1",
    ]);
  });
});
