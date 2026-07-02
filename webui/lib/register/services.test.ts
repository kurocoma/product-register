import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct, type ProductInput } from "../product/schema";
import type { ProductRow } from "../product/repository";
import type { RakutenCredentials } from "@/lib/rakuten/cabinet-client";
import type { YahooConfig } from "@/lib/yahoo/auth";
import {
  dryRunRakutenRegister,
  commitRakutenRegister,
  type RakutenRegisterDeps,
} from "./rakuten-register-service";
import {
  dryRunYahooRegister,
  commitYahooRegister,
  reserveYahooPublish,
  type YahooRegisterDeps,
} from "./yahoo-register-service";

const supabase = {} as unknown as SupabaseClient;
const cred: RakutenCredentials = { serviceSecret: "sec", licenseKey: "key" };
const cfg: YahooConfig = { clientId: "cid", clientSecret: "csec", refreshToken: "rt", sellerId: "test-store" };

/** 楽天: 呼び出し記録付きの注入deps（実送信しない）。 */
function rakutenDeps(opts: { exists?: boolean; upsertFail?: boolean; getItemThrows?: boolean } = {}) {
  const record = {
    upsertCalls: [] as { manageNumber: string; body: Record<string, unknown> }[],
    invCalls: [] as { manageNumber: string; variantId: string; quantity: number }[][],
    savedIds: [] as (string | undefined)[],
  };
  const deps: RakutenRegisterDeps = {
    getItem: async () => {
      if (opts.getItemThrows) throw new Error("network down");
      return { exists: opts.exists ?? false, status: opts.exists ? 200 : 404, json: null, raw: "" };
    },
    upsertItem: async (_c, manageNumber, body) => {
      record.upsertCalls.push({ manageNumber, body });
      if (opts.upsertFail) return { ok: false, status: 400, message: "IE0101 ジャンル必須属性不足", body: "detail-xml" };
      return { ok: true, created: !opts.exists, status: opts.exists ? 204 : 201 };
    },
    bulkUpsertInventory: async (_c, entries) => {
      record.invCalls.push(entries);
      return { ok: true, status: 200, message: "" };
    },
    upsertProduct: async (_s, _p, id) => {
      record.savedIds.push(id);
      return {} as ProductRow;
    },
  };
  return { deps, record };
}

describe("rakuten-register-service: dry-run", () => {
  it("有効な商品は valid=true・既存なしなら willOverwrite=false", async () => {
    const { deps } = rakutenDeps();
    const r = await dryRunRakutenRegister(cred, makeProduct(), deps);
    expect(r).toMatchObject({ ok: true, dryRun: true, mall: "rakuten", manageNumber: "t002-2542", valid: true, willOverwrite: false, missing: [] });
    expect(r.body.title).toBe("巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度");
  });

  it("既存商品があれば willOverwrite=true（上書きが事前に分かる）", async () => {
    const { deps } = rakutenDeps({ exists: true });
    const r = await dryRunRakutenRegister(cred, makeProduct(), deps);
    expect(r.exists).toBe(true);
    expect(r.willOverwrite).toBe(true);
  });

  it("既存確認が失敗してもプレビューは返す（exists=false 扱い）", async () => {
    const { deps } = rakutenDeps({ getItemThrows: true });
    const r = await dryRunRakutenRegister(cred, makeProduct(), deps);
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(false);
  });

  it("dry-run では hideItem を含まない従来 body（単一 route GET と同一形）", async () => {
    const { deps } = rakutenDeps();
    const r = await dryRunRakutenRegister(cred, makeProduct(), deps);
    expect(r.body.hideItem).toBeUndefined();
  });
});

describe("rakuten-register-service: commit", () => {
  it("安全既定: 倉庫(hideItem)・サーチ在庫非表示・在庫0 で登録し、掲載記録を保存する", async () => {
    const { deps, record } = rakutenDeps();
    const p = makeProduct();
    const r = await commitRakutenRegister(supabase, cred, p, "prod-1", {}, deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.safeState).toBe(true);
    expect(r.created).toBe(true);
    expect(r.inventorySet).toBe(true);
    expect(r.inventoryMessage).toBe("在庫0");

    // 送信 body は安全側（非公開 + 在庫非表示）
    const sent = record.upsertCalls[0];
    expect(sent.manageNumber).toBe("t002-2542");
    expect(sent.body.hideItem).toBe(true);
    expect(sent.body.unlimitedInventoryFlag).toBe(false);
    expect(sent.body.features).toEqual({ inventoryDisplay: "HIDDEN_STOCK" });

    // 在庫は 0 で別送
    expect(record.invCalls[0]).toEqual([{ manageNumber: "t002-2542", variantId: "t002-2542-1", quantity: 0 }]);

    // mall_listed / rakuten_manage_number の記録
    expect(p.mall_listed.rakuten).toBe(true);
    expect(p.rakuten_manage_number).toBe("t002-2542");
    expect(record.savedIds).toEqual(["prod-1"]);
  });

  it("publish=true を明示したときだけ公開状態（hideItem なし）", async () => {
    const { deps, record } = rakutenDeps();
    const r = await commitRakutenRegister(supabase, cred, makeProduct(), "prod-1", { publish: true }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.safeState).toBe(false);
    expect(record.upsertCalls[0].body.hideItem).toBeUndefined();
    expect(record.upsertCalls[0].body.features).toBeUndefined();
  });

  it("必須不足なら upsertItem を呼ばずに invalid で返す", async () => {
    const { deps, record } = rakutenDeps();
    const r = await commitRakutenRegister(supabase, cred, makeProduct({ mall_category_id: "" }), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("invalid");
    expect(r.error).toMatch(/^必須項目が不足: /);
    expect(record.upsertCalls).toHaveLength(0);
  });

  it("upsert 失敗は api エラー（メッセージ・status・detail 付き）", async () => {
    const { deps } = rakutenDeps({ upsertFail: true });
    const r = await commitRakutenRegister(supabase, cred, makeProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("api");
    if (r.kind !== "api") return;
    expect(r.error).toBe("items.upsert 失敗: IE0101 ジャンル必須属性不足");
    expect(r.apiStatus).toBe(400);
    expect(r.detail).toBe("detail-xml");
  });

  it("多SKU(variants[])は全SKU分の在庫を variant キーで別送する", async () => {
    const { deps, record } = rakutenDeps();
    const p = makeProduct({
      variants: [
        { sku_manage_number: "n050-3419-1", ne_code: "n050-3419-1", jan_code: "4582469493419", selling_price: 1637, tax_rate: 10 as const, quantity: 1 },
        { sku_manage_number: "n050-3419-s01", ne_code: "n050-3419-s01", jan_code: "4582469493426", selling_price: 3120, tax_rate: 10 as const, quantity: 1 },
      ],
    });
    const r = await commitRakutenRegister(supabase, cred, p, "prod-2", {}, deps);
    expect(r.ok).toBe(true);
    expect(record.invCalls[0].map((e) => e.variantId).sort()).toEqual(["n050-3419-1", "n050-3419-s01"]);
    expect(record.invCalls[0].every((e) => e.quantity === 0)).toBe(true);
  });
});

/** Yahoo: 呼び出し記録付きの注入deps（実送信しない）。 */
function yahooDeps(opts: { exists?: boolean; authFail?: boolean; editFail?: boolean } = {}) {
  const record = {
    editParams: [] as Record<string, string>[],
    reserveCalls: 0,
    stockCalls: 0,
    savedProducts: [] as ProductInput[],
  };
  const deps: YahooRegisterDeps = {
    getAccessToken: async () => {
      if (opts.authFail) throw new Error("invalid_grant (4102)");
      return "tok";
    },
    getItem: async () => ({ exists: opts.exists ?? false, raw: "" }),
    editItem: async (_t, params) => {
      record.editParams.push(params);
      if (opts.editFail) return { ok: false, message: "Code=px-04102", warnings: [], errors: ["Code=px-04102"] };
      return { ok: true, warnings: [] };
    },
    setStock: async () => {
      record.stockCalls++;
      return { ok: true, message: "" };
    },
    reservePublish: async () => {
      record.reserveCalls++;
      return { ok: true, message: "反映予約OK" };
    },
    upsertProduct: async (_s, p) => {
      record.savedProducts.push(p);
      return {} as ProductRow;
    },
  };
  return { deps, record };
}

describe("yahoo-register-service: dry-run", () => {
  it("有効な商品は valid=true・params に必須項目がそろう", async () => {
    const { deps } = yahooDeps();
    const r = await dryRunYahooRegister(cfg, makeProduct(), deps);
    expect(r).toMatchObject({ ok: true, dryRun: true, mall: "yahoo", itemCode: "t002-2542-1", valid: true, willOverwrite: false });
    expect(r.params.item_code).toBe("t002-2542-1");
    expect(r.params.seller_id).toBe("test-store");
  });

  it("認証失敗でもプレビュー自体は返す（exists=false 扱い）", async () => {
    const { deps } = yahooDeps({ authFail: true });
    const r = await dryRunYahooRegister(cfg, makeProduct(), deps);
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(false);
  });

  it("既存商品があれば willOverwrite=true", async () => {
    const { deps } = yahooDeps({ exists: true });
    const r = await dryRunYahooRegister(cfg, makeProduct(), deps);
    expect(r.willOverwrite).toBe(true);
  });
});

describe("yahoo-register-service: commit", () => {
  it("安全既定: display=0（非公開）で登録し、submit なしでは反映しない。掲載記録も保存する", async () => {
    const { deps, record } = yahooDeps();
    const p = makeProduct();
    const r = await commitYahooRegister(supabase, cfg, p, "prod-1", {}, deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wasUpdate).toBe(false);
    expect(r.submitted).toBe(false);
    expect(record.editParams[0].display).toBe("0"); // 安全既定 = 非表示
    expect(record.reserveCalls).toBe(0);
    // mall_listed.yahoo の記録（一覧の反映ボタン活性用）
    expect(p.mall_listed.yahoo).toBe(true);
    expect(record.savedProducts).toHaveLength(1);
  });

  it("submit=true のときだけ反映(reservePublish)まで行う", async () => {
    const { deps, record } = yahooDeps();
    const r = await commitYahooRegister(supabase, cfg, makeProduct(), "prod-1", { submit: true }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submitted).toBe(true);
    expect(r.submitMessage).toBe("反映予約OK");
    expect(record.reserveCalls).toBe(1);
  });

  it("認証失敗は auth エラー（再認証の案内付き）", async () => {
    const { deps } = yahooDeps({ authFail: true });
    const r = await commitYahooRegister(supabase, cfg, makeProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("auth");
    expect(r.error).toContain("リフレッシュトークン失効時は再認証");
  });

  it("必須不足（Yahooカテゴリなし等）は editItem を呼ばずに invalid で返す", async () => {
    const { deps, record } = yahooDeps();
    const r = await commitYahooRegister(
      supabase,
      cfg,
      makeProduct({ yahoo_path: "", yahoo_category_id: "" }),
      "prod-1",
      {},
      deps,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("invalid");
    expect(record.editParams).toHaveLength(0);
  });

  it("editItem 失敗は api エラー", async () => {
    const { deps } = yahooDeps({ editFail: true });
    const r = await commitYahooRegister(supabase, cfg, makeProduct(), "prod-1", {}, deps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("api");
    if (r.kind !== "api") return;
    expect(r.error).toBe("editItem 失敗: Code=px-04102");
  });
});

describe("yahoo-register-service: reserveYahooPublish（一括登録の最後に1回だけ）", () => {
  it("反映予約に成功する", async () => {
    const { deps, record } = yahooDeps();
    const r = await reserveYahooPublish(cfg, deps);
    expect(r).toEqual({ ok: true, message: "反映予約OK" });
    expect(record.reserveCalls).toBe(1);
  });

  it("認証失敗は ok:false で理由を返す（例外にしない）", async () => {
    const { deps } = yahooDeps({ authFail: true });
    const r = await reserveYahooPublish(cfg, deps);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("invalid_grant");
  });
});
