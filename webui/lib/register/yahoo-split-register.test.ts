import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct, type ProductInput } from "../product/schema";
import type { ProductRow } from "../product/repository";
import type { YahooConfig } from "@/lib/yahoo/auth";
import {
  dryRunYahooRegister,
  commitYahooRegister,
  type YahooRegisterDeps,
} from "./yahoo-register-service";

const supabase = {} as unknown as SupabaseClient;
const cfg: YahooConfig = { clientId: "cid", clientSecret: "csec", refreshToken: "rt", sellerId: "test-store" };

/** バリエーションキー統合で作られる形の統合商品（既定 3SKU）。 */
function unified(skus = 3): ProductInput {
  const quantities = [1, 6, 24].slice(0, skus);
  return makeProduct({
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    variation_key: "レモネード500",
    rakuten_manage_number: "a009-4916",
    variants: quantities.map((q) => ({
      sku_manage_number: `a009-4916-${q}`,
      ne_code: `a009-4916-${q}`,
      jan_code: "4514603474916",
      selling_price: 200 * q,
      tax_rate: 10 as const,
      quantity: q,
      variation_value: `${q}本`,
      shipping_type: "送料別",
    })),
  });
}

/** SKU（item_code）別に既存有無・editItem 失敗を制御できる注入 deps（実送信しない）。 */
function yahooDeps(opts: { existsCodes?: string[]; failCodes?: string[]; authFail?: boolean } = {}) {
  const record = {
    editParams: [] as Record<string, string>[],
    getItemCodes: [] as string[],
    reserveCalls: 0,
    stockCodes: [] as string[],
    savedProducts: [] as ProductInput[],
    savedIds: [] as (string | undefined)[],
  };
  const deps: YahooRegisterDeps = {
    getAccessToken: async () => {
      if (opts.authFail) throw new Error("invalid_grant (4102)");
      return "tok";
    },
    getItem: async (_t, _s, code) => {
      record.getItemCodes.push(code);
      return { exists: (opts.existsCodes ?? []).includes(code), raw: "" };
    },
    editItem: async (_t, params) => {
      record.editParams.push(params);
      if ((opts.failCodes ?? []).includes(params.item_code)) {
        return { ok: false, message: "Code=px-04102", warnings: [], errors: ["Code=px-04102"] };
      }
      return { ok: true, warnings: [] };
    },
    setStock: async (_t, _s, code) => {
      record.stockCodes.push(code);
      return { ok: true, message: "" };
    },
    reservePublish: async () => {
      record.reserveCalls++;
      return { ok: true, message: "反映予約OK" };
    },
    upsertProduct: async (_s, p, id) => {
      record.savedProducts.push(p);
      record.savedIds.push(id);
      return {} as ProductRow;
    },
  };
  return { deps, record };
}

describe("yahoo-register-service: dry-run（統合商品は SKU 別に分けて判定）", () => {
  it("統合商品(3SKU)は items[] に SKU 別計画・itemCode/params は代表（先頭SKU）", async () => {
    const { deps } = yahooDeps();
    const r = await dryRunYahooRegister(cfg, unified(3), deps);
    expect(r.skuCount).toBe(3);
    expect(r.itemCode).toBe("a009-4916-1");
    expect(r.params.item_code).toBe("a009-4916-1");
    expect(r.items?.map((i) => i.itemCode)).toEqual(["a009-4916-1", "a009-4916-6", "a009-4916-24"]);
    // SKU別 params（item_code / 税込価格が SKU ごとに違う）
    expect(r.items?.map((i) => i.params.item_code)).toEqual(["a009-4916-1", "a009-4916-6", "a009-4916-24"]);
    expect(r.items?.map((i) => i.params.price)).toEqual(["220", "1320", "5280"]);
    expect(r.valid).toBe(true);
  });

  it("exists は「いずれかのSKUが既存」で集約し、SKU別の exists は items[] に残る", async () => {
    const { deps } = yahooDeps({ existsCodes: ["a009-4916-6"] });
    const r = await dryRunYahooRegister(cfg, unified(3), deps);
    expect(r.exists).toBe(true);
    expect(r.willOverwrite).toBe(true);
    expect(r.items?.map((i) => i.exists)).toEqual([false, true, false]);
  });

  it("単一SKU・フラット商品は従来形（skuCount=1・items なし）", async () => {
    const { deps } = yahooDeps();
    const r = await dryRunYahooRegister(cfg, makeProduct(), deps);
    expect(r).toMatchObject({ ok: true, mall: "yahoo", itemCode: "t002-2542-1", valid: true });
    expect(r.skuCount).toBe(1);
    expect(r.items).toBeUndefined();
  });
});

describe("yahoo-register-service: commit（統合商品は SKU ごとに editItem を逐次実行）", () => {
  it("全SKU成功: SKUごとに editItem・掲載記録は元の統合商品を1回だけ保存する", async () => {
    const { deps, record } = yahooDeps();
    const p = unified(3);
    const r = await commitYahooRegister(supabase, cfg, p, "prod-1", {}, deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(record.editParams.map((e) => e.item_code)).toEqual(["a009-4916-1", "a009-4916-6", "a009-4916-24"]);
    // 安全既定: 全SKU display=0（非表示）
    expect(record.editParams.every((e) => e.display === "0")).toBe(true);
    expect(r.skuSummary).toEqual({ total: 3, succeeded: 3, failed: 0, message: "3SKU中3件登録" });
    expect(r.skuResults?.every((s) => s.ok)).toBe(true);

    // 掲載記録: SKU擬似商品ではなく「元の統合商品」を productId へ1回だけ保存（DB破壊防止）
    expect(record.savedProducts).toHaveLength(1);
    expect(record.savedIds).toEqual(["prod-1"]);
    expect(record.savedProducts[0]).toBe(p);
    expect(record.savedProducts[0].variants).toHaveLength(3); // variants が消えていない
    expect(p.mall_listed.yahoo).toBe(true);
  });

  it("1件目成功・2件目失敗でも残りSKUの登録を継続し、成否を集約する", async () => {
    const { deps, record } = yahooDeps({ failCodes: ["a009-4916-6"] });
    const r = await commitYahooRegister(supabase, cfg, unified(3), "prod-1", {}, deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2件目が失敗しても 3件目まで editItem が呼ばれる（継続）
    expect(record.editParams.map((e) => e.item_code)).toEqual(["a009-4916-1", "a009-4916-6", "a009-4916-24"]);
    expect(r.skuSummary?.total).toBe(3);
    expect(r.skuSummary?.succeeded).toBe(2);
    expect(r.skuSummary?.failed).toBe(1);
    expect(r.skuSummary?.message).toContain("3SKU中2件登録・1件失敗");
    expect(r.skuSummary?.message).toContain("a009-4916-6");
    const failedSku = r.skuResults?.find((s) => !s.ok);
    expect(failedSku?.itemCode).toBe("a009-4916-6");
    expect(failedSku?.error).toContain("px-04102");
    // 1件以上成功したので掲載記録は行う
    expect(record.savedProducts).toHaveLength(1);
  });

  it("全SKU失敗は api エラー（SKU別の理由つき）・掲載記録もしない", async () => {
    const { deps, record } = yahooDeps({ failCodes: ["a009-4916-1", "a009-4916-6", "a009-4916-24"] });
    const r = await commitYahooRegister(supabase, cfg, unified(3), "prod-1", {}, deps);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("api");
    expect(r.error).toContain("3SKU中0件登録");
    expect(r.error).toContain("a009-4916-1");
    expect(record.savedProducts).toHaveLength(0);
  });

  it("必須不足のSKUが混在しても他のSKUは登録され、不足SKUは理由つきで失敗になる", async () => {
    const { deps, record } = yahooDeps();
    const p = unified(2);
    p.variants[1].ne_code = ""; // 2SKU目は item_code 不足 = 必須不足
    const r = await commitYahooRegister(supabase, cfg, p, "prod-1", {}, deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(record.editParams).toHaveLength(1); // 不足SKUは editItem を呼ばない
    expect(r.skuSummary?.succeeded).toBe(1);
    expect(r.skuSummary?.failed).toBe(1);
    expect(r.skuResults?.[1].error).toContain("必須項目が不足");
  });

  it("submit=true でも反映(reservePublish)はストア全体単位で1回だけ", async () => {
    const { deps, record } = yahooDeps();
    const r = await commitYahooRegister(supabase, cfg, unified(3), "prod-1", { submit: true }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submitted).toBe(true);
    expect(record.reserveCalls).toBe(1);
  });

  it("認証失敗は SKU 処理前に auth エラー（editItem を1回も呼ばない）", async () => {
    const { deps, record } = yahooDeps({ authFail: true });
    const r = await commitYahooRegister(supabase, cfg, unified(3), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("auth");
    expect(record.editParams).toHaveLength(0);
  });

  it("単一SKU商品は従来どおり（skuResults/skuSummary なしの従来形）", async () => {
    const { deps, record } = yahooDeps();
    const r = await commitYahooRegister(supabase, cfg, makeProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemCode).toBe("t002-2542-1");
    expect(r.skuResults).toBeUndefined();
    expect(r.skuSummary).toBeUndefined();
    expect(record.editParams).toHaveLength(1);
  });
});
