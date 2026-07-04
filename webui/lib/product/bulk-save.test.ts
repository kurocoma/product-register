import { describe, it, expect } from "vitest";
import { makeProduct, type ProductInput } from "./schema";
import { resolveSavedIds, saveGroupWithCleanup, type GroupSaveDeps } from "./bulk-save";

/** 呼び出し記録付きの注入 deps（DB を呼ばない）。 */
function makeDeps(opts: { upsertFail?: boolean; removeFailIds?: string[] } = {}) {
  const record = {
    upserts: [] as { ne_code: string; id?: string }[],
    removed: [] as string[],
  };
  const deps: GroupSaveDeps = {
    upsert: async (p: ProductInput, id?: string) => {
      if (opts.upsertFail) throw new Error("このNEコードは既に使われています");
      record.upserts.push({ ne_code: p.ne_code, id });
      return { id: id ?? "new-id" };
    },
    remove: async (id: string) => {
      if ((opts.removeFailIds ?? []).includes(id)) throw new Error("削除に失敗しました");
      record.removed.push(id);
    },
  };
  return { deps, record };
}

describe("resolveSavedIds（統合グループの更新先と孤児の決定）", () => {
  it("全行が未保存なら primary も orphans も無い（新規作成）", () => {
    expect(resolveSavedIds([undefined, undefined])).toEqual({ primaryId: undefined, orphanIds: [] });
  });

  it("最初に見つかった savedId を primary にする（従来の更新先と同一）", () => {
    expect(resolveSavedIds([undefined, "A", undefined])).toEqual({ primaryId: "A", orphanIds: [] });
  });

  it("別々の savedId が混在したら primary 以外の distinct な ID が orphans になる", () => {
    expect(resolveSavedIds(["A", "B", "A", "C"])).toEqual({ primaryId: "A", orphanIds: ["B", "C"] });
  });

  it("空文字の savedId は無視する", () => {
    expect(resolveSavedIds(["", "B"])).toEqual({ primaryId: "B", orphanIds: [] });
  });
});

describe("saveGroupWithCleanup（統合保存 + 旧フラット商品の整理）", () => {
  const product = makeProduct();

  it("複数 savedId のグループ: primary へ保存し、吸収された旧商品を削除して1商品化する", async () => {
    const { deps, record } = makeDeps();
    const r = await saveGroupWithCleanup(product, ["A", "B", "C"], deps);
    expect(record.upserts).toEqual([{ ne_code: product.ne_code, id: "A" }]); // 更新先は primary のみ
    expect(record.removed).toEqual(["B", "C"]); // 孤児化していた旧フラット商品を削除
    expect(r).toEqual({ savedId: "A", wasUpdate: true, cleanedIds: ["B", "C"], cleanupFailed: [] });
  });

  it("保存(upsert)が失敗したら例外を投げ、削除は一切行わない（誤削除ガード）", async () => {
    const { deps, record } = makeDeps({ upsertFail: true });
    await expect(saveGroupWithCleanup(product, ["A", "B"], deps)).rejects.toThrow("既に使われています");
    expect(record.removed).toEqual([]); // 保存成功時のみ削除
  });

  it("削除の失敗は保存結果を覆さず cleanupFailed で返す（成功分は cleanedIds）", async () => {
    const { deps, record } = makeDeps({ removeFailIds: ["B"] });
    const r = await saveGroupWithCleanup(product, ["A", "B", "C"], deps);
    expect(r.savedId).toBe("A");
    expect(r.cleanedIds).toEqual(["C"]);
    expect(r.cleanupFailed).toEqual([{ id: "B", message: "削除に失敗しました" }]);
    expect(record.removed).toEqual(["C"]);
  });

  it("savedId が1つだけなら従来どおり更新のみ（削除なし）", async () => {
    const { deps, record } = makeDeps();
    const r = await saveGroupWithCleanup(product, [undefined, "A"], deps);
    expect(r).toEqual({ savedId: "A", wasUpdate: true, cleanedIds: [], cleanupFailed: [] });
    expect(record.removed).toEqual([]);
  });

  it("savedId が無ければ新規作成（削除なし・wasUpdate=false）", async () => {
    const { deps, record } = makeDeps();
    const r = await saveGroupWithCleanup(product, [undefined, undefined], deps);
    expect(r).toEqual({ savedId: "new-id", wasUpdate: false, cleanedIds: [], cleanupFailed: [] });
    expect(record.upserts).toEqual([{ ne_code: product.ne_code, id: undefined }]);
    expect(record.removed).toEqual([]);
  });

  it("同じ savedId を持つ行だけのグループでは削除しない（distinct 判定）", async () => {
    const { deps, record } = makeDeps();
    const r = await saveGroupWithCleanup(product, ["A", "A", "A"], deps);
    expect(r.cleanedIds).toEqual([]);
    expect(record.removed).toEqual([]);
  });
});
