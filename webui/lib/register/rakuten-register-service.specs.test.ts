import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct } from "@/lib/product/schema";
import {
  commitRakutenRegister,
  dryRunRakutenRegister,
  prepareRakutenProductForUpsert,
  type RakutenRegisterDeps,
} from "./rakuten-register-service";

const CRED = { serviceSecret: "s", licenseKey: "l" } as never;
const SB = {} as SupabaseClient;

const localProduct = (specs?: { label: string; value: string }[]) =>
  makeProduct({
    rakuten_manage_number: "r-specs-1",
    variants: [
      {
        sku_manage_number: "sku-a",
        ne_code: "sku-a",
        jan_code: "4589837521231",
        selling_price: 1000,
        tax_rate: 10,
        quantity: 1,
        variation_value: "1袋",
        ...(specs !== undefined ? { specs } : {}),
      },
    ],
  });

const existingJson = {
  variants: {
    "sku-a": {
      merchantDefinedSkuId: "sku-a",
      standardPrice: "1000",
      articleNumber: { value: "4589837521231" },
      specs: [{ label: "既存の無関係項目", value: "保持する値" }],
    },
  },
};

describe("prepareRakutenProductForUpsert — 全置換upsertの自由入力行保護", () => {
  it("未管理(undefined)だけを楽天snapshotから補完する", () => {
    const prepared = prepareRakutenProductForUpsert(localProduct(), existingJson);
    expect(prepared.errors).toEqual([]);
    expect(prepared.product.variants[0].specs).toEqual([
      { label: "既存の無関係項目", value: "保持する値" },
    ]);
  });

  it("ローカルで明示した編集値・空配列はsnapshotで上書きしない", () => {
    const edited = prepareRakutenProductForUpsert(
      localProduct([{ label: "保存方法", value: "常温" }]),
      existingJson,
    );
    expect(edited.product.variants[0].specs).toEqual([{ label: "保存方法", value: "常温" }]);

    const cleared = prepareRakutenProductForUpsert(localProduct([]), existingJson);
    expect(cleared.product.variants[0].specs).toEqual([]);
  });

  it("対応SKUをsnapshotから取得できなければ安全に停止する", () => {
    const prepared = prepareRakutenProductForUpsert(localProduct(), { variants: {} });
    expect(prepared.errors).toHaveLength(1);
    expect(prepared.errors[0]).toContain("自由入力行を補完できません");
  });
});

describe("楽天登録サービス — specs完全payload", () => {
  it("dry-runは既存の未管理specsを補完したbodyを表示する", async () => {
    const deps: RakutenRegisterDeps = {
      getItem: async () => ({ exists: true, status: 200, json: existingJson, raw: "" }),
      upsertItem: (async () => ({ ok: true, created: false, status: 200, message: "", body: {} })) as never,
      bulkUpsertInventory: (async () => ({ ok: true, message: "" })) as never,
      upsertProduct: (async () => ({})) as never,
    };
    const result = await dryRunRakutenRegister(CRED, localProduct(), deps);
    const variant = (result.body.variants as Record<string, { specs: unknown }>)["sku-a"];
    expect(result.valid).toBe(true);
    expect(variant.specs).toEqual([{ label: "既存の無関係項目", value: "保持する値" }]);
  });

  it("既存snapshotとSKU照合できない場合はupsertを呼ばない", async () => {
    let upsertCalled = false;
    const deps: RakutenRegisterDeps = {
      getItem: async () => ({ exists: true, status: 200, json: { variants: {} }, raw: "" }),
      upsertItem: (async () => {
        upsertCalled = true;
        return { ok: true, created: false, status: 200, message: "", body: {} };
      }) as never,
      bulkUpsertInventory: (async () => ({ ok: true, message: "" })) as never,
      upsertProduct: (async () => ({})) as never,
    };
    const result = await commitRakutenRegister(SB, CRED, localProduct(), "id-1", {}, deps);
    expect(result.ok).toBe(false);
    expect(upsertCalled).toBe(false);
    if (!result.ok) expect(result.error).toContain("完全payload");
  });
});
