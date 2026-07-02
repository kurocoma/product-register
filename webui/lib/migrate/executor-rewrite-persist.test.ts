import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";

function fakeProduct(): ProductInput {
  return {
    ne_code: "NE-1", mall_category_id: "G1", yahoo_category_id: "", yahoo_path: "",
    yahoo_grouping_enabled: false, image_count: 1, delivery_method: 4, lead_time: 1,
    display_name: "元名", catch_copy_yahoo: "元コピー", free1: "元説明",
  } as unknown as ProductInput;
}
function fakeCategory(): YahooCategoryMapping {
  return { yahoo_category_id: "1", yahoo_category_name: "X", yahoo_path: "a", confidence: "high" };
}
function makeDeps(over: Partial<ExecutorDeps> = {}) {
  const product = fakeProduct();
  const deps: ExecutorDeps = {
    resolveRakutenItem: vi.fn(async (m: string) => ({ json: {}, resolvedCode: m })),
    parseItem: vi.fn(() => ({}) as Partial<ProductInput>),
    parseVariants: vi.fn(() => [] as Variant[]),
    buildImported: vi.fn(() => ({ ok: true as const, product, neCode: "NE-1" })),
    resolveCategory: vi.fn(async () => fakeCategory()),
    findExisting: vi.fn(async () => null),
    upsert: vi.fn(async () => ({ id: "P-1" })),
    buildYahooParams: vi.fn(() => ({
      seller_id: "S", item_code: "NE-1", path: "p", name: "n", product_category: "1", price: "1000",
    })),
    validateYahoo: vi.fn(() => ({ ok: true as const })),
    editYahoo: vi.fn(async () => ({ ok: true as const, warnings: [] as string[] })),
    ...over,
  };
  return { deps, product };
}

/** リライトの恒久化: 保存済み yahoo_rewrite の自動適用（リロード後の再実行でも
 *  楽天の元名へ戻らない）と、commit 時の保存（既存=saveRewrites / 新規=upsert 同乗）。 */
describe("makePerItemExecutor — リライト恒久化", () => {
  it("保存済みリライトを自動適用する（request override なし・リロード後の再実行を想定）", async () => {
    const { deps, product } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-1", rewrites: { name: "保存名" } })),
    });
    const r = await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(product.display_name).toBe("保存名");
    expect(r.rewriteApplied).toBe(true);
  });

  it("request override が保存済みリライトより優先される", async () => {
    const { deps, product } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-1", rewrites: { name: "保存名" } })),
    });
    await makePerItemExecutor(deps, {
      dryRun: true,
      overrides: { "a-1": { name: "新名" } },
    })({ manageNumber: "a-1" });
    expect(product.display_name).toBe("新名");
  });

  it("commit + 既存 + request override → saveRewrites でマージ結果を保存する", async () => {
    const saveRewrites = vi.fn(async () => {});
    const { deps } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-1", rewrites: { headline: "保存コピー" } })),
      saveRewrites,
    });
    await makePerItemExecutor(deps, {
      dryRun: false,
      overrides: { "a-1": { name: "新名" } },
    })({ manageNumber: "a-1" });
    expect(saveRewrites).toHaveBeenCalledWith("P-1", { name: "新名", headline: "保存コピー" });
  });

  it("dry-run では saveRewrites を呼ばない（書き込みなし維持）", async () => {
    const saveRewrites = vi.fn(async () => {});
    const { deps } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-1", rewrites: {} })),
      saveRewrites,
    });
    await makePerItemExecutor(deps, {
      dryRun: true,
      overrides: { "a-1": { name: "新名" } },
    })({ manageNumber: "a-1" });
    expect(saveRewrites).not.toHaveBeenCalled();
  });

  it("保存済みのみの適用（新規リライトなし）では saveRewrites を呼ばない（無駄な書き込み回避）", async () => {
    const saveRewrites = vi.fn(async () => {});
    const { deps } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-1", rewrites: { name: "保存名" } })),
      saveRewrites,
    });
    await makePerItemExecutor(deps, { dryRun: false })({ manageNumber: "a-1" });
    expect(saveRewrites).not.toHaveBeenCalled();
  });

  it("新規商品は yahoo_rewrite 込みで upsert され恒久化される", async () => {
    let saved: ProductInput | null = null;
    const { deps } = makeDeps({
      findExisting: vi.fn(async () => null),
      upsert: vi.fn(async (p: ProductInput) => {
        saved = p;
        return { id: "P-9" };
      }),
    });
    await makePerItemExecutor(deps, {
      dryRun: false,
      overrides: { "a-1": { name: "新名" } },
    })({ manageNumber: "a-1" });
    expect(saved).not.toBeNull();
    expect(saved!.yahoo_rewrite).toEqual({ name: "新名" });
    expect(saved!.display_name).toBe("新名");
  });

  it("保存済み headline のみ → catch_copy_yahoo に適用され display_name は元のまま", async () => {
    const { deps, product } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-1", rewrites: { headline: "保存コピー" } })),
    });
    await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(product.catch_copy_yahoo).toBe("保存コピー");
    expect(product.display_name).toBe("元名");
  });
});
