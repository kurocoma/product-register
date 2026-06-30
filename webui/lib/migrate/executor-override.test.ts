import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";
import type { FieldTruncation } from "./types";

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
    findExisting: vi.fn(async () => null as { id: string } | null),
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

describe("makePerItemExecutor — 手動リライト override / 切り詰め検出", () => {
  it("overrides で display_name/catch_copy_yahoo/free1 を上書き", async () => {
    const { deps, product } = makeDeps();
    await makePerItemExecutor(deps, {
      dryRun: true,
      overrides: { "a-1": { name: "新名", headline: "新コピー", explanation: "新説明" } },
    })({ manageNumber: "a-1" });
    expect(product.display_name).toBe("新名");
    expect(product.catch_copy_yahoo).toBe("新コピー");
    expect(product.free1).toBe("新説明");
  });
  it("別 manageNumber の override は適用しない", async () => {
    const { deps, product } = makeDeps();
    await makePerItemExecutor(deps, { dryRun: true, overrides: { other: { name: "X" } } })({
      manageNumber: "a-1",
    });
    expect(product.display_name).toBe("元名");
  });
  it("detectTruncations の結果が dry-run result.truncations に載る", async () => {
    const tr: FieldTruncation[] = [
      { field: "name", label: "商品名", limit: 75, fullWidthLen: 80, original: "x", fitted: "y" },
    ];
    const { deps } = makeDeps({ detectTruncations: vi.fn(() => tr) });
    const r = await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(r.truncations).toEqual(tr);
  });
  it("切り詰めなし → truncations は付かない", async () => {
    const { deps } = makeDeps({ detectTruncations: vi.fn(() => []) });
    const r = await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(r.truncations).toBeUndefined();
  });
});
