import { describe, it, expect } from "vitest";
import { aggregate, runItems } from "./result";
import type { MigrationItemResult } from "./types";

function res(manageNumber: string, status: MigrationItemResult["status"]): MigrationItemResult {
  return { manageNumber, step: "register", ok: status === "ok" || status === "migrate", status };
}

describe("aggregate — dry-run の migrate を集計する（回帰防止）", () => {
  it('status="migrate"（dry-run の移行可）を migrated に数える', () => {
    const s = aggregate([
      res("a", "migrate"),
      res("b", "migrate"),
      res("c", "migrate"),
      res("d", "requires_manual"),
      res("e", "failed"),
    ]);
    // dry-run プレビュー: 移行可3 / 要手動1 / 失敗1 / total5（skipped0）
    expect(s).toEqual({ total: 5, migrated: 3, requiresManual: 1, skipped: 0, failed: 1 });
  });

  it("migrate と ok が混在しても両方 migrated に合算される", () => {
    const s = aggregate([res("a", "migrate"), res("b", "ok")]);
    expect(s.migrated).toBe(2);
    expect(s.total).toBe(2);
  });

  it("dry-run の全件 migrate は migrated=total（移行可件数が0にならない）", () => {
    const results = [res("x", "migrate"), res("y", "migrate")];
    const s = aggregate(results);
    expect(s.migrated).toBe(2);
    expect(s.migrated).toBe(s.total);
  });
});

describe("runItems — レート制御(delayMs) は既定で挙動を変えない", () => {
  it("delayMs 未指定なら sleep は呼ばれず順序保持（既存挙動）", async () => {
    let slept = 0;
    const out = await runItems(
      [{ manageNumber: "a" }, { manageNumber: "b" }],
      async (it) => res(it.manageNumber, "migrate"),
      { sleep: async () => { slept++; } },
    );
    expect(out.map((r) => r.manageNumber)).toEqual(["a", "b"]);
    expect(slept).toBe(0); // delayMs 既定0 → 待機しない
  });

  it("delayMs>0 なら item 間に注入 sleep を挟む（先頭前・末尾後は待たない）", async () => {
    const waited: number[] = [];
    const items = [{ manageNumber: "a" }, { manageNumber: "b" }, { manageNumber: "c" }];
    const out = await runItems(items, async (it) => res(it.manageNumber, "migrate"), {
      delayMs: 50,
      sleep: async (ms) => { waited.push(ms); },
    });
    expect(out.map((r) => r.manageNumber)).toEqual(["a", "b", "c"]);
    // 3件 → 間は2回だけ
    expect(waited).toEqual([50, 50]);
  });
});
