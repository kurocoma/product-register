import { describe, it, expect, vi } from "vitest";
import { makePerItemExecutor, type ExecutorDeps } from "./executor";
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";
import type { EditItemResult } from "@/lib/yahoo/item-client";

/** A1-A4 の commit 経路（順序是正・uploaded 駆動 item_image_urls・全失敗→failed・
 *  warnings surface・it-14091 リトライ）を fake で検証する。live API は呼ばない。 */

type Params = Record<string, string>;

function fakeProduct(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    ne_code: "NE-9",
    mall_category_id: "G1",
    yahoo_category_id: "",
    yahoo_path: "",
    yahoo_grouping_enabled: false,
    image_count: 3,
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

function makeDeps(
  overrides: Partial<ExecutorDeps> = {},
  productOverrides: Partial<ProductInput> = {},
): { deps: ExecutorDeps; order: string[] } {
  const order: string[] = [];
  const deps: ExecutorDeps = {
    resolveRakutenItem: vi.fn(async (mn: string) => ({ json: { genreId: "G1" }, resolvedCode: mn })),
    parseItem: vi.fn(() => ({}) as Partial<ProductInput>),
    parseVariants: vi.fn(() => [] as Variant[]),
    buildImported: vi.fn(() => ({
      ok: true as const,
      product: fakeProduct(productOverrides),
      neCode: "NE-9",
    })),
    resolveCategory: vi.fn(async () => fakeCategory()),
    findExisting: vi.fn(async () => null as { id: string } | null),
    upsert: vi.fn(async () => {
      order.push("upsert");
      return { id: "P-1" };
    }),
    buildYahooParams: vi.fn(
      (): Params => ({
        seller_id: "S",
        item_code: "NE-9",
        path: "food",
        name: "X",
        product_category: "13457",
        price: "1000",
        item_image_urls: "PLACEHOLDER",
      }),
    ),
    validateYahoo: vi.fn(() => ({ ok: true as const })),
    editYahoo: vi.fn(async (): Promise<EditItemResult> => {
      order.push("editYahoo");
      return { ok: true, warnings: [] };
    }),
    syncImage: vi.fn(async () => {
      order.push("syncImage");
      return { ok: true, uploaded: [1, 2, 3] as number[] };
    }),
    recordHistory: vi.fn(async () => {
      order.push("recordHistory");
    }),
    ...overrides,
  };
  return { deps, order };
}

describe("executor commit — 画像同期を editItem の前に実行 (A1)", () => {
  it("commit 順は upsert→syncImage→editYahoo→recordHistory", async () => {
    const { deps, order } = makeDeps();
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("ok");
    expect(order).toEqual(["upsert", "syncImage", "editYahoo", "recordHistory"]);
    // syncImage は editYahoo より前に呼ばれる（it-14091 本解消の核）
    expect(order.indexOf("syncImage")).toBeLessThan(order.indexOf("editYahoo"));
  });
});

describe("executor commit — uploaded 駆動 item_image_urls (A2/A3)", () => {
  it("buildImageUrls をアップロード成功 index のみで呼び editParams を上書きする", async () => {
    const captured: Params[] = [];
    const buildImageUrls = vi.fn(
      (neCode: string, indices: number[]) => `B/${neCode}/${indices.join(",")}`,
    );
    const editYahoo = vi.fn(async (params: Params): Promise<EditItemResult> => {
      captured.push(params);
      return { ok: true, warnings: [] };
    });
    const { deps } = makeDeps({
      buildImageUrls,
      editYahoo,
      syncImage: vi.fn(async () => ({ ok: true, uploaded: [1, 3] as number[] })), // #2 は失敗扱い
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    await exec({ manageNumber: "abc-1" });

    expect(buildImageUrls).toHaveBeenCalledWith("NE-9", [1, 3]);
    expect(captured[0].item_image_urls).toBe("B/NE-9/1,3");
  });

  it("buildImageUrls 未注入なら editParams.item_image_urls は不変（後方互換）", async () => {
    const captured: Params[] = [];
    const editYahoo = vi.fn(async (params: Params): Promise<EditItemResult> => {
      captured.push(params);
      return { ok: true, warnings: [] };
    });
    const { deps } = makeDeps({ editYahoo, syncImage: vi.fn(async () => ({ ok: true })) });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("ok");
    expect(captured[0].item_image_urls).toBe("PLACEHOLDER");
  });
});

describe("executor commit — 全画像失敗は登録中止 (A2)", () => {
  it("対象画像があるのに uploaded が空なら status=failed・editYahoo を呼ばない", async () => {
    const editYahoo = vi.fn(async (): Promise<EditItemResult> => ({ ok: true, warnings: [] }));
    const { deps } = makeDeps({
      editYahoo,
      buildImageUrls: vi.fn(() => "X"),
      syncImage: vi.fn(async () => ({ ok: false, error: "全失敗", uploaded: [] as number[] })),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("failed");
    expect(r.step).toBe("image");
    expect(editYahoo).not.toHaveBeenCalled();
  });
});

describe("executor commit — warnings surface (A2)", () => {
  it("editItem 成功時の warnings(it-14091等) を結果に surface する", async () => {
    const { deps } = makeDeps({
      editYahoo: vi.fn(
        async (): Promise<EditItemResult> => ({
          ok: true,
          warnings: ["it-14091 追加画像が未紐づけ"],
        }),
      ),
    });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(r.status).toBe("ok");
    expect(r.error).toContain("editItem警告");
    expect(r.error).toContain("it-14091");
  });
});

describe("executor commit — it-14091/im-02005 リトライ (A4)", () => {
  it("editItem が it-14091 を返したら sleep 後に1回だけ再試行する", async () => {
    const results: EditItemResult[] = [
      { ok: false, message: "it-14091", warnings: [], errors: ["it-14091 画像未紐づけ"] },
      { ok: true, warnings: [] },
    ];
    let call = 0;
    const editYahoo = vi.fn(async (): Promise<EditItemResult> => results[call++]);
    const sleep = vi.fn(async () => {});
    const { deps } = makeDeps({ editYahoo, sleep });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(editYahoo).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("ok");
  });

  it("画像と無関係な editItem 失敗はリトライしない（1回で failed）", async () => {
    const editYahoo = vi.fn(
      async (): Promise<EditItemResult> => ({
        ok: false,
        message: "it-01023",
        warnings: [],
        errors: ["it-01023"],
      }),
    );
    const sleep = vi.fn(async () => {});
    const { deps } = makeDeps({ editYahoo, sleep });
    const exec = makePerItemExecutor(deps, { dryRun: false });
    const r = await exec({ manageNumber: "abc-1" });

    expect(editYahoo).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r.status).toBe("failed");
  });
});
