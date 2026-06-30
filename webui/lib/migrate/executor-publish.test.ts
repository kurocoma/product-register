import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";

/** 公開フロー（publish=true: display=1 + setStock + submitItem）の検証。
 *  fake は live API を呼ばず、buildYahooParams は実 item-mapper と同様に forceDisplay を
 *  params.display へ反映する（forceDisplay 未指定なら display を出さない＝executor 側で "1" 付与）。 */
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
  return { yahoo_category_id: "13457", yahoo_category_name: "X", yahoo_path: "a > b", confidence: "high" };
}

function makeDeps(over: Partial<ExecutorDeps> = {}) {
  const editParamsSent: Record<string, string>[] = [];
  const setStockCalls: Array<[string, number]> = [];
  const submitCalls: string[] = [];
  const deps: ExecutorDeps = {
    resolveRakutenItem: vi.fn(async (m: string) => ({ json: { genreId: "G1" }, resolvedCode: m })),
    parseItem: vi.fn(() => fakeProduct() as Partial<ProductInput>),
    parseVariants: vi.fn(() => [] as Variant[]),
    buildImported: vi.fn(() => ({ ok: true as const, product: fakeProduct(), neCode: "NE-1" })),
    resolveCategory: vi.fn(async () => fakeCategory()),
    findExisting: vi.fn(async () => null as { id: string } | null),
    upsert: vi.fn(async () => ({ id: "P-1" })),
    buildYahooParams: vi.fn((_p: ProductInput, opts: { forUpdate: boolean; forceDisplay?: string }) => {
      const params: Record<string, string> = {
        seller_id: "S",
        item_code: "NE-1",
        path: "food",
        name: "X",
        product_category: "13457",
        price: "1000",
      };
      if (opts.forceDisplay !== undefined) params.display = opts.forceDisplay;
      return params;
    }),
    validateYahoo: vi.fn(() => ({ ok: true as const })),
    editYahoo: vi.fn(async (p: Record<string, string>) => {
      editParamsSent.push({ ...p });
      return { ok: true as const, warnings: [] as string[] };
    }),
    setStock: vi.fn(async (itemCode: string, q: number) => {
      setStockCalls.push([itemCode, q]);
      return { ok: true, message: "OK" };
    }),
    submitYahoo: vi.fn(async (itemCode: string) => {
      submitCalls.push(itemCode);
      return { ok: true, message: "OK" };
    }),
    recordHistory: vi.fn(async () => {}),
    ...over,
  };
  return { deps, editParamsSent, setStockCalls, submitCalls };
}

describe("makePerItemExecutor — 公開で登録 (publish)", () => {
  it("publish=true: editItem に display='1' を送り、setStock→submitItem を呼ぶ", async () => {
    const { deps, editParamsSent, setStockCalls, submitCalls } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false, publish: true, stockQuantity: 50 });
    const r = await exec({ manageNumber: "abc-1" });
    expect(r.status).toBe("ok");
    expect(editParamsSent.at(-1)?.display).toBe("1");
    expect(setStockCalls).toEqual([["NE-1", 50]]);
    expect(submitCalls).toEqual(["NE-1"]);
  });

  it("publish=false(既定): setStock/submitItem は呼ばれず display は '0'", async () => {
    const { deps, editParamsSent, setStockCalls, submitCalls } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false });
    await exec({ manageNumber: "abc-1" });
    expect(editParamsSent.at(-1)?.display).toBe("0");
    expect(setStockCalls).toEqual([]);
    expect(submitCalls).toEqual([]);
  });

  it("stockQuantity=0: setStock は呼ばず submitItem は呼ぶ（在庫据え置きで公開反映）", async () => {
    const { deps, setStockCalls, submitCalls } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false, publish: true, stockQuantity: 0 });
    await exec({ manageNumber: "abc-1" });
    expect(setStockCalls).toEqual([]);
    expect(submitCalls).toEqual(["NE-1"]);
  });

  it("setStock 失敗は登録成功のまま注意として surface する", async () => {
    const { deps } = makeDeps({ setStock: vi.fn(async () => ({ ok: false, message: "NG-stock" })) });
    const exec = makePerItemExecutor(deps, { dryRun: false, publish: true, stockQuantity: 9 });
    const r = await exec({ manageNumber: "abc-1" });
    expect(r.status).toBe("ok");
    expect(r.error).toContain("在庫設定");
    expect(r.error).toContain("NG-stock");
  });

  it("submitItem 失敗も登録成功のまま注意として surface する", async () => {
    const { deps } = makeDeps({ submitYahoo: vi.fn(async () => ({ ok: false, message: "NG-submit" })) });
    const exec = makePerItemExecutor(deps, { dryRun: false, publish: true, stockQuantity: 9 });
    const r = await exec({ manageNumber: "abc-1" });
    expect(r.status).toBe("ok");
    expect(r.error).toContain("公開反映");
  });

  it("dry-run は publish 指定でも書き込み系(editItem/setStock/submitItem)を呼ばない", async () => {
    const { deps, setStockCalls, submitCalls } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: true, publish: true, stockQuantity: 9 });
    const r = await exec({ manageNumber: "abc-1" });
    expect(r.status).toBe("migrate");
    expect(setStockCalls).toEqual([]);
    expect(submitCalls).toEqual([]);
    expect(deps.editYahoo).not.toHaveBeenCalled();
  });
});
