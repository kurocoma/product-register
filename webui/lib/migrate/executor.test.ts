import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import { aggregate, runItems } from "./result";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";

/** 最小限の ProductInput スタブ（executor は注入 fake 経由でしか触らないため形だけ整える）。 */
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

/** 呼び出し順を記録しつつ、すべて成功する deps を作る。overrides で1条件だけ崩す。 */
function makeDeps(overrides: Partial<ExecutorDeps> = {}): {
  deps: ExecutorDeps;
  order: string[];
  spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const order: string[] = [];
  const track = <T,>(name: string, value: T): T => {
    order.push(name);
    return value;
  };

  const resolveRakutenItem = vi.fn(async (manageNumber: string) =>
    track("resolveRakutenItem", { json: { genreId: "G1" }, resolvedCode: manageNumber }),
  );
  const parseItem = vi.fn(() => track("parseItem", fakeProduct() as Partial<ProductInput>));
  const parseVariants = vi.fn(() => track("parseVariants", [] as Variant[]));
  const buildImported = vi.fn(() =>
    track("buildImported", { ok: true as const, product: fakeProduct(), neCode: "NE-1" }),
  );
  const resolveCategory = vi.fn(async () => track("resolveCategory", fakeCategory()));
  const findExisting = vi.fn(async () => track("findExisting", null as { id: string } | null));
  const upsert = vi.fn(async () => track("upsert", { id: "P-new" }));
  const buildYahooParams = vi.fn(() =>
    track("buildYahooParams", {
      seller_id: "S",
      item_code: "NE-1",
      path: "food",
      name: "X",
      product_category: "13457",
      price: "1000",
    }),
  );
  const validateYahoo = vi.fn(() => track("validateYahoo", { ok: true as const }));
  const editYahoo = vi.fn(async () => track("editYahoo", { ok: true as const, warnings: [] }));
  const syncImage = vi.fn(async () => track("syncImage", { ok: true }));
  const recordHistory = vi.fn(async () => {
    order.push("recordHistory");
  });

  const deps: ExecutorDeps = {
    resolveRakutenItem,
    parseItem,
    parseVariants,
    buildImported,
    resolveCategory,
    findExisting,
    upsert,
    buildYahooParams,
    validateYahoo,
    editYahoo,
    syncImage,
    recordHistory,
    ...overrides,
  };

  return {
    deps,
    order,
    spies: {
      resolveRakutenItem,
      parseItem,
      parseVariants,
      buildImported,
      resolveCategory,
      findExisting,
      upsert,
      buildYahooParams,
      validateYahoo,
      editYahoo,
      syncImage,
      recordHistory,
    },
  };
}

describe("makePerItemExecutor — dry-run（既定）", () => {
  it("書き込み系(upsert/editItem/画像/履歴)を一切呼ばず status=migrate を返す (AC-005)", async () => {
    const { deps, spies } = makeDeps();
    const exec = makePerItemExecutor(deps); // 既定 dryRun=true
    const r = await exec({ manageNumber: "abc-1" });

    expect(r).toMatchObject({ manageNumber: "abc-1", ok: true, status: "migrate" });
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.editYahoo).not.toHaveBeenCalled();
    expect(spies.syncImage).not.toHaveBeenCalled();
    expect(spies.recordHistory).not.toHaveBeenCalled();
  });
});

describe("makePerItemExecutor — commit 正常系", () => {
  it("副作用の順序を保ち status=ok を返す", async () => {
    const { deps, order, spies } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r).toMatchObject({ manageNumber: "abc-1", ok: true, status: "ok", productId: "P-new" });

    // 書き込み/効果のある呼び出しの相対順序（buildImported→findExisting→upsert→editItem→image→history）
    const effects = order.filter((n) =>
      ["buildImported", "findExisting", "upsert", "editYahoo", "syncImage", "recordHistory"].includes(n),
    );
    expect(effects).toEqual([
      "buildImported",
      "findExisting",
      "upsert",
      "editYahoo",
      "syncImage",
      "recordHistory",
    ]);
    expect(spies.recordHistory).toHaveBeenCalledWith(
      "create",
      "P-new",
      expect.objectContaining({ mall: "yahoo" }),
    );
  });

  it("安全既定: commit の buildYahooParams は forceDisplay='0' で呼ばれる (AC-002)", async () => {
    const { deps, spies } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false }); // publish 既定 false
    await exec({ manageNumber: "abc-1" });

    for (const call of spies.buildYahooParams.mock.calls) {
      expect(call[1]).toMatchObject({ forceDisplay: "0" });
    }
    expect(spies.validateYahoo).toHaveBeenCalled();
    expect(spies.editYahoo).toHaveBeenCalled();
  });

  it("publish=true なら forceDisplay は送らない（display=1 委譲）", async () => {
    const { deps, spies } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false, publish: true });
    await exec({ manageNumber: "abc-1" });
    for (const call of spies.buildYahooParams.mock.calls) {
      expect(call[1].forceDisplay).toBeUndefined();
    }
  });
});

describe("makePerItemExecutor — 安全スキップ（登録しない）", () => {
  it("カテゴリ未解決(null)→requires_manual。登録系は呼ばれない (AC-004)", async () => {
    const { deps, spies } = makeDeps({ resolveCategory: vi.fn(async () => null) });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("requires_manual");
    expect(r.step).toBe("category");
    expect(r.error).toContain("Yahooカテゴリ");
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.editYahoo).not.toHaveBeenCalled();
  });

  it("多SKU(variants>1)→requires_manual。登録系は呼ばれない (AC-008)", async () => {
    const twoVariants = [{}, {}] as unknown as Variant[];
    const { deps, spies } = makeDeps({ parseVariants: vi.fn(() => twoVariants) });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("requires_manual");
    expect(r.error).toContain("多SKU");
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.editYahoo).not.toHaveBeenCalled();
  });

  it("高度なYahoo設定(yahoo_grouping_enabled)→requires_manual (AC-008)", async () => {
    const { deps, spies } = makeDeps({
      buildImported: vi.fn(() => ({
        ok: true as const,
        product: fakeProduct({ yahoo_grouping_enabled: true }),
        neCode: "NE-1",
      })),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("requires_manual");
    expect(r.error).toContain("高度なYahoo設定");
    expect(spies.upsert).not.toHaveBeenCalled();
  });
});

describe("makePerItemExecutor — 既存重複排除 (AC-007)", () => {
  it("existed=true なら upsert を呼ばず既存 productId を採用", async () => {
    const { deps, spies } = makeDeps({
      findExisting: vi.fn(async () => ({ id: "P-existing" })),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("ok");
    expect(r.productId).toBe("P-existing");
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.recordHistory).toHaveBeenCalledWith("edit", "P-existing", expect.anything());
  });
});

describe("makePerItemExecutor — 失敗の取り扱い", () => {
  it("楽天に商品が無い→status=failed, step=import", async () => {
    const { deps, spies } = makeDeps({ resolveRakutenItem: vi.fn(async () => null) });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "missing-1" });

    expect(r.status).toBe("failed");
    expect(r.step).toBe("import");
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(spies.editYahoo).not.toHaveBeenCalled();
  });

  it("Yahoo必須項目不足→登録せず安全側に分類（editItem は呼ばれない）", async () => {
    const { deps, spies } = makeDeps({
      validateYahoo: vi.fn(() => ({ ok: false as const, missing: ["price"] })),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    // 必須不足は plan(missingRequiredYahooFields) で requires_manual になり登録しない
    expect(["failed", "requires_manual"]).toContain(r.status);
    expect(spies.editYahoo).not.toHaveBeenCalled();
  });

  it("editItem 失敗→status=failed, step=register", async () => {
    const { deps } = makeDeps({
      editYahoo: vi.fn(async () => ({
        ok: false as const,
        message: "it-XXXXX",
        warnings: [],
        errors: ["it-XXXXX"],
      })),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("failed");
    expect(r.step).toBe("register");
    expect(r.error).toContain("editItem");
  });
});

describe("runItems + executor — 失敗継続 (AC-003)", () => {
  it("1件 throw でも残りが処理され summary.failed に計上・順序保持", async () => {
    const { deps } = makeDeps({
      resolveRakutenItem: vi.fn(async (mn: string) => {
        if (mn === "boom") throw new Error("楽天APIエラー");
        return { json: { genreId: "G1" }, resolvedCode: mn };
      }),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const items = [{ manageNumber: "a" }, { manageNumber: "boom" }, { manageNumber: "c" }];
    const results = await runItems(items, exec, { continueOnError: true });

    expect(results.map((r) => r.manageNumber)).toEqual(["a", "boom", "c"]);
    expect(results[1].status).toBe("failed");
    const s = aggregate(results);
    expect(s.total).toBe(3);
    expect(s.migrated).toBe(2);
    expect(s.failed).toBe(1);
  });
});
