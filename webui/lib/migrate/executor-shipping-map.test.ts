import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";

function fakeProduct(o: Partial<ProductInput> = {}): ProductInput {
  return {
    ne_code: "NE-1", mall_category_id: "G1", yahoo_category_id: "", yahoo_path: "",
    yahoo_grouping_enabled: false, image_count: 1, delivery_method: 4, lead_time: 1, ...o,
  } as unknown as ProductInput;
}
function fakeCategory(): YahooCategoryMapping {
  return { yahoo_category_id: "1", yahoo_category_name: "X", yahoo_path: "a", confidence: "high" };
}

function makeDeps(over: Partial<ExecutorDeps> = {}, parsedExtra: Record<string, unknown> = {}) {
  const product = fakeProduct();
  const deps: ExecutorDeps = {
    resolveRakutenItem: vi.fn(async (m: string) => ({ json: {}, resolvedCode: m })),
    parseItem: vi.fn(() => ({ ...parsedExtra }) as Partial<ProductInput>),
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

describe("makePerItemExecutor — 配送・発送マッピング解決", () => {
  it("resolveShipping の値で delivery_method/lead_time を上書き", async () => {
    const { deps, product } = makeDeps(
      { resolveShipping: vi.fn(async () => ({ postageSet: 10, leadTime: 3 })) },
      { _rakutenShippingGroup: "10", _rakutenDeliveryDateId: "1" },
    );
    await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(deps.resolveShipping).toHaveBeenCalledWith("10", "1");
    expect(product.delivery_method).toBe(10);
    expect(product.lead_time).toBe(3);
  });
  it("未指定項目は現状維持（postageSet のみ返す）", async () => {
    const { deps, product } = makeDeps({ resolveShipping: vi.fn(async () => ({ postageSet: 7 })) });
    await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(product.delivery_method).toBe(7);
    expect(product.lead_time).toBe(1);
  });
  it("resolveShipping 未注入 → 既定のまま（後退しない）", async () => {
    const { deps, product } = makeDeps();
    await makePerItemExecutor(deps, { dryRun: true })({ manageNumber: "a-1" });
    expect(product.delivery_method).toBe(4);
    expect(product.lead_time).toBe(1);
  });
});
