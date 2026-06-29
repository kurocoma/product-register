import { describe, it, expect } from "vitest";
import { aggregate, runItems } from "./result";
import type { MigrationItemResult } from "./types";

/** AC-H03: ItemStatus 'skipped' を実条件で emit することを固定する。
 *  continueOnError=false で item が status:"failed" を返したら、残りは実行せず
 *  status:"skipped"（前段の失敗で中断）として積む。既存 result.test.ts は無改変。 */

function ok(manageNumber: string): MigrationItemResult {
  return { manageNumber, step: "register", ok: true, status: "ok" };
}
function failed(manageNumber: string): MigrationItemResult {
  return { manageNumber, step: "register", ok: false, status: "failed", error: "登録失敗" };
}

describe("runItems — continueOnError=false の skipped emit (AC-H03)", () => {
  it("2件目が failed を返すと3件目以降は status='skipped'（順序保持・未実行）", async () => {
    const seen: string[] = [];
    const items = [
      { manageNumber: "a" },
      { manageNumber: "b" },
      { manageNumber: "c" },
      { manageNumber: "d" },
    ];
    const out = await runItems(
      items,
      async (it) => {
        seen.push(it.manageNumber);
        return it.manageNumber === "b" ? failed(it.manageNumber) : ok(it.manageNumber);
      },
      { continueOnError: false },
    );

    // c, d は perItem を呼ばれない（未実行）
    expect(seen).toEqual(["a", "b"]);
    // 結果は全件・入力順を保持
    expect(out.map((r) => r.manageNumber)).toEqual(["a", "b", "c", "d"]);
    expect(out.map((r) => r.status)).toEqual(["ok", "failed", "skipped", "skipped"]);
    for (const r of out.filter((x) => x.status === "skipped")) {
      expect(r.ok).toBe(false);
      expect(r.error).toContain("中断");
    }

    const s = aggregate(out);
    expect(s).toEqual({ total: 4, migrated: 1, requiresManual: 0, skipped: 2, failed: 1 });
  });

  it("continueOnError=true（既定）では failed があっても skipped を出さず全件処理（回帰）", async () => {
    const items = [{ manageNumber: "a" }, { manageNumber: "b" }, { manageNumber: "c" }];
    const out = await runItems(items, async (it) =>
      it.manageNumber === "b" ? failed(it.manageNumber) : ok(it.manageNumber),
    );

    expect(out.map((r) => r.manageNumber)).toEqual(["a", "b", "c"]);
    const s = aggregate(out);
    expect(s.skipped).toBe(0);
    expect(s.failed).toBe(1);
    expect(s.migrated).toBe(2);
  });

  it("requires_manual は失敗ではないので continueOnError=false でも打ち切らない", async () => {
    const items = [{ manageNumber: "a" }, { manageNumber: "b" }];
    const out = await runItems(
      items,
      async (it) =>
        it.manageNumber === "a"
          ? { manageNumber: "a", step: "category", ok: false, status: "requires_manual" }
          : ok(it.manageNumber),
      { continueOnError: false },
    );

    expect(out.map((r) => r.status)).toEqual(["requires_manual", "ok"]);
    expect(aggregate(out).skipped).toBe(0);
  });
});
