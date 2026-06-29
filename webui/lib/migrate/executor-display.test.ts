import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";

/** AC-H02: 既存(forUpdate)の公開中商品を一括移行で非表示化しないことを検証する。
 *  buildYahooParams に渡る forceDisplay の値（既存=保持で undefined / 新規=安全既定 "0"）を確認。
 *  既存 executor.test.ts は無改変。本ファイルは display 規約だけを独立に固定する。 */

function fakeProduct(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    ne_code: "NE-1",
    mall_category_id: "G1",
    yahoo_category_id: "",
    yahoo_path: "",
    yahoo_grouping_enabled: false,
    image_count: 1,
    ...overrides,
  } as unknown as ProductInput;
}

function fakeCategory(): YahooCategoryMapping {
  return {
    yahoo_category_id: "13457",
    yahoo_category_name: "日本酒",
    yahoo_path: "食品 > 酒",
    confidence: "high",
  };
}

/** 既存照合の結果(existing)だけ差し替えられる成功 deps を作る。 */
function makeDeps(existing: { id: string } | null): {
  deps: ExecutorDeps;
  buildYahooParams: ReturnType<typeof vi.fn>;
} {
  const buildYahooParams = vi.fn(() => ({
    seller_id: "S",
    item_code: "NE-1",
    path: "food",
    name: "X",
    product_category: "13457",
    price: "1000",
  }));
  const deps: ExecutorDeps = {
    resolveRakutenItem: vi.fn(async (manageNumber: string) => ({
      json: { genreId: "G1" },
      resolvedCode: manageNumber,
    })),
    parseItem: vi.fn(() => fakeProduct() as Partial<ProductInput>),
    parseVariants: vi.fn(() => [] as Variant[]),
    buildImported: vi.fn(() => ({ ok: true as const, product: fakeProduct(), neCode: "NE-1" })),
    resolveCategory: vi.fn(async () => fakeCategory()),
    findExisting: vi.fn(async () => existing),
    upsert: vi.fn(async () => ({ id: "P-new" })),
    buildYahooParams,
    validateYahoo: vi.fn(() => ({ ok: true as const })),
    editYahoo: vi.fn(async () => ({ ok: true as const, warnings: [] })),
    syncImage: vi.fn(async () => ({ ok: true })),
    recordHistory: vi.fn(async () => {}),
  };
  return { deps, buildYahooParams };
}

/** buildYahooParams 全呼び出しの forceDisplay 値を取り出す。 */
function forceDisplayValues(spy: ReturnType<typeof vi.fn>): unknown[] {
  return spy.mock.calls.map((c) => (c[1] as { forceDisplay?: unknown }).forceDisplay);
}

describe("makePerItemExecutor — display 保持 (AC-H02)", () => {
  it("既存(existed=true)は forceDisplay を送らない（undefined=現在表示を保持）", async () => {
    const { deps, buildYahooParams } = makeDeps({ id: "P-existing" });
    const exec = makePerItemExecutor(deps, { dryRun: false }); // preserveExistingDisplay 既定 true
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("ok");
    expect(buildYahooParams).toHaveBeenCalled();
    for (const v of forceDisplayValues(buildYahooParams)) {
      expect(v).toBeUndefined();
    }
  });

  it("新規(existed=false)は安全既定 forceDisplay='0' を明示送信", async () => {
    const { deps, buildYahooParams } = makeDeps(null);
    const exec = makePerItemExecutor(deps, { dryRun: false });
    await exec({ manageNumber: "abc-1" });

    for (const v of forceDisplayValues(buildYahooParams)) {
      expect(v).toBe("0");
    }
  });

  it("preserveExistingDisplay:false なら既存にも従来どおり '0' を強制（オプトアウト可）", async () => {
    const { deps, buildYahooParams } = makeDeps({ id: "P-existing" });
    const exec = makePerItemExecutor(deps, { dryRun: false, preserveExistingDisplay: false });
    await exec({ manageNumber: "abc-1" });

    for (const v of forceDisplayValues(buildYahooParams)) {
      expect(v).toBe("0");
    }
  });

  it("publish=true は display を委譲し forceDisplay を送らない（従来通り）", async () => {
    const { deps, buildYahooParams } = makeDeps(null);
    const exec = makePerItemExecutor(deps, { dryRun: false, publish: true });
    await exec({ manageNumber: "abc-1" });

    for (const v of forceDisplayValues(buildYahooParams)) {
      expect(v).toBeUndefined();
    }
  });
});
