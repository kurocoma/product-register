/** 在庫数の入力・送信と倉庫選択のテスト（仕様変更 260720）。
 * 背景: 登録は常に倉庫＋在庫0の「安全登録」だったため、既存の公開中商品を
 * 上書き登録すると倉庫入り・在庫0で潰れていた。
 * 新仕様:
 * - SKU の stock_quantity 入力済み → その値を在庫送信
 * - 未入力: 既存商品 → 在庫を変更しない（送信スキップ）／新規 → 従来どおり0
 * - keepExistingState: 既存商品の倉庫/公開状態を現状維持（新規は従来どおり倉庫） */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct } from "../product/schema";
import {
  buildInventoryPlan,
  commitRakutenRegister,
  dryRunRakutenRegister,
  type RakutenRegisterDeps,
} from "./rakuten-register-service";

const CRED = { serviceSecret: "s", licenseKey: "l" } as never;

const twoSkus = (stockA?: number, stockB?: number) => [
  { sku_manage_number: "r3001-1", ne_code: "r3001-1", jan_code: "4589837521231", selling_price: 1000, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", variation_value: "1袋", ...(stockA !== undefined ? { stock_quantity: stockA } : {}) },
  { sku_manage_number: "r3001-3", ne_code: "r3001-3", jan_code: "4589837521248", selling_price: 2800, tax_rate: 10 as const, quantity: 3, shipping_type: "送料無料", variation_value: "3袋", ...(stockB !== undefined ? { stock_quantity: stockB } : {}) },
];

describe("buildInventoryPlan（在庫送信の決定・純関数）", () => {
  it("既存商品＋全SKU未入力 → 空（在庫を変更しない＝0で潰さない）", () => {
    expect(buildInventoryPlan(makeProduct({ variants: twoSkus() }), true)).toEqual([]);
  });

  it("既存商品＋一部入力 → 入力済みSKUだけ送る", () => {
    expect(buildInventoryPlan(makeProduct({ variants: twoSkus(5) }), true)).toEqual([
      { variantId: "r3001-1", quantity: 5 },
    ]);
  });

  it("新規商品＋未入力 → 従来どおり全SKU 0（安全登録）", () => {
    expect(buildInventoryPlan(makeProduct({ variants: twoSkus() }), false)).toEqual([
      { variantId: "r3001-1", quantity: 0 },
      { variantId: "r3001-3", quantity: 0 },
    ]);
  });

  it("在庫0の明示入力は既存商品でも0を送る（意図的なゼロ化は可能）", () => {
    expect(buildInventoryPlan(makeProduct({ variants: twoSkus(0, 7) }), true)).toEqual([
      { variantId: "r3001-1", quantity: 0 },
      { variantId: "r3001-3", quantity: 7 },
    ]);
  });

  it("フラット商品は商品レベルの在庫数を合成SKUに引き継ぐ", () => {
    const p = makeProduct({ ne_code: "a-1", stock_quantity: 5, variants: [] });
    expect(buildInventoryPlan(p, true)).toEqual([{ variantId: "a-1", quantity: 5 }]);
  });
});

/** commit 用のフェイク deps（実送信しない）。 */
function fakeDeps(existing: { exists: boolean; json?: Record<string, unknown> }) {
  const calls: { body?: Record<string, unknown>; inventory?: unknown[] } = {};
  const deps: RakutenRegisterDeps = {
    getItem: async () => ({ exists: existing.exists, status: existing.exists ? 200 : 404, json: existing.json ?? null, raw: "" }),
    upsertItem: (async (_c: unknown, _m: unknown, body: unknown) => {
      calls.body = body as Record<string, unknown>;
      return { ok: true, created: !existing.exists, status: 200, message: "", body: {} };
    }) as never,
    bulkUpsertInventory: (async (_c: unknown, items: unknown[]) => {
      calls.inventory = items;
      return { ok: true, message: "" };
    }) as never,
    upsertProduct: (async () => ({})) as never,
  };
  return { deps, calls };
}
const SB = {} as SupabaseClient;

describe("commitRakutenRegister: 在庫と倉庫の新仕様", () => {
  it("既存＋未入力＋現状維持 → 在庫API を呼ばず、倉庫フラグも送らない（公開中を維持）", async () => {
    const { deps, calls } = fakeDeps({ exists: true, json: {} }); // hideItem 無し = 公開中
    const p = makeProduct({ variants: twoSkus(), rakuten_manage_number: "r3001-1", mall_listed: { rakuten: true } });
    const r = await commitRakutenRegister(SB, CRED, p, "id-1", { keepExistingState: true }, deps);
    expect(r.ok).toBe(true);
    expect(calls.inventory).toBe(undefined); // 在庫送信なし
    expect(calls.body?.hideItem).toBe(undefined); // 倉庫に入れない
  });

  it("既存が倉庫中なら現状維持で倉庫のまま（hideItem を踏襲）", async () => {
    const { deps, calls } = fakeDeps({ exists: true, json: { hideItem: true } });
    const p = makeProduct({ variants: twoSkus(), rakuten_manage_number: "r3001-1", mall_listed: { rakuten: true } });
    await commitRakutenRegister(SB, CRED, p, "id-1", { keepExistingState: true }, deps);
    expect(calls.body?.hideItem).toBe(true);
  });

  it("倉庫指定（既定）は従来どおり hideItem/hideStock で送る", async () => {
    const { deps, calls } = fakeDeps({ exists: true, json: {} });
    const p = makeProduct({ variants: twoSkus(), rakuten_manage_number: "r3001-1", mall_listed: { rakuten: true } });
    await commitRakutenRegister(SB, CRED, p, "id-1", {}, deps);
    expect(calls.body?.hideItem).toBe(true);
  });

  it("在庫入力済みSKUはその値で在庫送信する", async () => {
    const { deps, calls } = fakeDeps({ exists: true, json: {} });
    const p = makeProduct({ variants: twoSkus(5), rakuten_manage_number: "r3001-1", mall_listed: { rakuten: true } });
    await commitRakutenRegister(SB, CRED, p, "id-1", { keepExistingState: true }, deps);
    expect(calls.inventory).toEqual([{ manageNumber: "r3001-1", variantId: "r3001-1", quantity: 5 }]);
  });

  it("新規＋未入力は従来どおり全SKU在庫0で送る（安全登録の互換）", async () => {
    const { deps, calls } = fakeDeps({ exists: false });
    const p = makeProduct({ variants: twoSkus() });
    await commitRakutenRegister(SB, CRED, p, "id-1", {}, deps);
    expect(calls.inventory).toEqual([
      { manageNumber: expect.any(String), variantId: "r3001-1", quantity: 0 },
      { manageNumber: expect.any(String), variantId: "r3001-3", quantity: 0 },
    ]);
    expect(calls.body?.hideItem).toBe(true);
  });
});

describe("dryRunRakutenRegister: 在庫送信予定のプレビュー", () => {
  it("既存商品: 入力SKU=数値・未入力SKU=null（変更なし）で返す", async () => {
    const { deps } = fakeDeps({ exists: true, json: {} });
    const p = makeProduct({ variants: twoSkus(5), rakuten_manage_number: "r3001-1" });
    const r = await dryRunRakutenRegister(CRED, p, deps);
    expect(r.inventoryPlan).toEqual([
      { variantId: "r3001-1", quantity: 5 },
      { variantId: "r3001-3", quantity: null },
    ]);
  });
});
