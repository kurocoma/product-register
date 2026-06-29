import { describe, it, expect } from "vitest";
import { aggregate, runItems } from "./result";
import type { MigrationItemResult } from "./types";

function res(manageNumber: string, status: MigrationItemResult["status"]): MigrationItemResult {
  return { manageNumber, step: "register", ok: status === "ok", status };
}

describe("aggregate", () => {
  it("ステータス別に正しく集計（total=配列長）", () => {
    const s = aggregate([
      res("a", "ok"),
      res("b", "ok"),
      res("c", "requires_manual"),
      res("d", "skipped"),
      res("e", "failed"),
    ]);
    expect(s).toEqual({ total: 5, migrated: 2, requiresManual: 1, skipped: 1, failed: 1 });
  });

  it("空配列はすべて0", () => {
    expect(aggregate([])).toEqual({
      total: 0,
      migrated: 0,
      requiresManual: 0,
      skipped: 0,
      failed: 0,
    });
  });
});

describe("runItems", () => {
  it("入力順を保持して結果を返す", async () => {
    const items = [{ manageNumber: "a" }, { manageNumber: "b" }, { manageNumber: "c" }];
    const out = await runItems(items, async (it) => res(it.manageNumber, "ok"));
    expect(out.map((r) => r.manageNumber)).toEqual(["a", "b", "c"]);
  });

  it("1件 throw でも継続し summary.failed に計上（失敗継続）", async () => {
    const items = [{ manageNumber: "a" }, { manageNumber: "boom" }, { manageNumber: "c" }];
    const out = await runItems(items, async (it) => {
      if (it.manageNumber === "boom") throw new Error("登録APIエラー");
      return res(it.manageNumber, "ok");
    });
    expect(out.map((r) => r.manageNumber)).toEqual(["a", "boom", "c"]);
    const boom = out[1];
    expect(boom.status).toBe("failed");
    expect(boom.ok).toBe(false);
    expect(boom.error).toBe("登録APIエラー");

    const s = aggregate(out);
    expect(s).toEqual({ total: 3, migrated: 2, requiresManual: 0, skipped: 0, failed: 1 });
  });

  it("非Error の reject も String 化して結果化", async () => {
    const out = await runItems([{ manageNumber: "x" }], async () => {
      throw "raw string error";
    });
    expect(out[0].status).toBe("failed");
    expect(out[0].error).toBe("raw string error");
  });

  it("continueOnError=false なら最初の throw で打ち切る", async () => {
    const seen: string[] = [];
    const items = [{ manageNumber: "a" }, { manageNumber: "boom" }, { manageNumber: "c" }];
    const out = await runItems(
      items,
      async (it) => {
        seen.push(it.manageNumber);
        if (it.manageNumber === "boom") throw new Error("stop");
        return res(it.manageNumber, "ok");
      },
      { continueOnError: false },
    );
    expect(seen).toEqual(["a", "boom"]); // c は実行されない
    expect(out.map((r) => r.manageNumber)).toEqual(["a", "boom"]);
    expect(out[1].status).toBe("failed");
  });

  it("errorStep を指定すると失敗結果の step に反映", async () => {
    const out = await runItems(
      [{ manageNumber: "x" }],
      async () => {
        throw new Error("e");
      },
      { errorStep: "import" },
    );
    expect(out[0].step).toBe("import");
  });

  it("既定の errorStep は register", async () => {
    const out = await runItems([{ manageNumber: "x" }], async () => {
      throw new Error("e");
    });
    expect(out[0].step).toBe("register");
  });
});
