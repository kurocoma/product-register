import { describe, it, expect, vi } from "vitest";
import type { BulkItemResult } from "./types";
import {
  runBulkRegisterSequential,
  type BulkRunDeps,
  type BulkRunProgress,
  type BulkRunTarget,
} from "./bulk-run";

const t = (n: number): BulkRunTarget => ({
  id: `id-${n}`,
  ne_code: `ne-${n}`,
  product_name: `商品${n}`,
});

const okResult = (target: BulkRunTarget): BulkItemResult => ({
  id: target.id,
  ne_code: target.ne_code,
  product_name: target.product_name,
  ok: true,
  valid: true,
  registered: true,
});

const ngResult = (target: BulkRunTarget, error: string): BulkItemResult => ({
  id: target.id,
  ne_code: target.ne_code,
  product_name: target.product_name,
  ok: false,
  error,
});

/** 呼び出し記録付きの注入deps（実送信しない）。resultByIndex で件別の成否を指定する。 */
function makeDeps(resultByIndex: Array<"ok" | "ng" | "throw">) {
  let i = 0;
  const reserveSubmit = vi.fn(async () => ({ submitted: true, submitMessage: "予約OK" }));
  const progresses: BulkRunProgress[] = [];
  const deps: BulkRunDeps = {
    registerOne: vi.fn(async (target: BulkRunTarget) => {
      const kind = resultByIndex[i++];
      if (kind === "throw") throw new Error("network down");
      return kind === "ok" ? okResult(target) : ngResult(target, "editItem 失敗");
    }),
    reserveSubmit,
    onProgress: (p) => progresses.push(p),
  };
  return { deps, reserveSubmit, progresses };
}

describe("runBulkRegisterSequential: 反映予約は最終件の成否に依存しない（E1）", () => {
  it("2件中1件目成功・2件目失敗でも反映予約が1回実行される", async () => {
    const { deps, reserveSubmit } = makeDeps(["ok", "ng"]);
    const r = await runBulkRegisterSequential([t(1), t(2)], { submit: true }, deps);
    expect(reserveSubmit).toHaveBeenCalledTimes(1); // 最終件が失敗しても先行成功分の反映を予約する
    expect(r.submit).toEqual({ submitted: true, submitMessage: "予約OK" });
    expect(r.okIds).toEqual(["id-1"]);
    expect(r.results.map((x) => x.ok)).toEqual([true, false]);
  });

  it("最終件だけ成功のときも予約される（従来挙動の維持）", async () => {
    const { deps, reserveSubmit } = makeDeps(["ng", "ok"]);
    const r = await runBulkRegisterSequential([t(1), t(2)], { submit: true }, deps);
    expect(reserveSubmit).toHaveBeenCalledTimes(1);
    expect(r.okIds).toEqual(["id-2"]);
  });

  it("全件失敗なら予約せず、理由メッセージを返す", async () => {
    const { deps, reserveSubmit } = makeDeps(["ng", "ng"]);
    const r = await runBulkRegisterSequential([t(1), t(2)], { submit: true }, deps);
    expect(reserveSubmit).not.toHaveBeenCalled();
    expect(r.submit).toEqual({
      submitted: false,
      submitMessage: "登録に成功した商品がないため反映を予約しませんでした",
    });
  });

  it("submit=false（楽天・反映チェックOFF）なら成功があっても予約しない", async () => {
    const { deps, reserveSubmit } = makeDeps(["ok", "ok"]);
    const r = await runBulkRegisterSequential([t(1), t(2)], { submit: false }, deps);
    expect(reserveSubmit).not.toHaveBeenCalled();
    expect(r.submit).toBeNull();
  });

  it("予約の通信例外は submitted=false として返す（例外を投げない）", async () => {
    const { deps } = makeDeps(["ok"]);
    deps.reserveSubmit = vi.fn(async () => {
      throw new Error("timeout");
    });
    const r = await runBulkRegisterSequential([t(1)], { submit: true }, deps);
    expect(r.submit?.submitted).toBe(false);
    expect(r.submit?.submitMessage).toContain("timeout");
  });
});

describe("runBulkRegisterSequential: 逐次実行と部分失敗", () => {
  it("1件の通信例外で全体を止めない（該当件は通信エラーとして記録し続行）", async () => {
    const { deps } = makeDeps(["ok", "throw", "ok"]);
    const r = await runBulkRegisterSequential([t(1), t(2), t(3)], { submit: false }, deps);
    expect(r.results).toHaveLength(3);
    expect(r.results[1].ok).toBe(false);
    expect(r.results[1].error).toContain("通信エラー");
    expect(r.results[1].ne_code).toBe("ne-2"); // 編集リンク用の商品情報を保持
    expect(r.okIds).toEqual(["id-1", "id-3"]);
  });

  it("1件ずつ順番に登録する（並列にしない）", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const deps: BulkRunDeps = {
      registerOne: async (target) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((res) => setTimeout(res, 1));
        inFlight--;
        return okResult(target);
      },
      reserveSubmit: async () => ({ submitted: true }),
    };
    await runBulkRegisterSequential([t(1), t(2), t(3)], { submit: false }, deps);
    expect(maxInFlight).toBe(1);
  });

  it("進捗を1件ごとに通知する（done/total/成功/失敗）", async () => {
    const { deps, progresses } = makeDeps(["ok", "ng"]);
    await runBulkRegisterSequential([t(1), t(2)], { submit: false }, deps);
    expect(progresses).toEqual([
      { done: 1, total: 2, ok: 1, ng: 0 },
      { done: 2, total: 2, ok: 1, ng: 1 },
    ]);
  });

  it("対象0件なら何もせず終了する（予約要求があっても成功0なので予約しない）", async () => {
    const { deps, reserveSubmit } = makeDeps([]);
    const r = await runBulkRegisterSequential([], { submit: true }, deps);
    expect(r.results).toEqual([]);
    expect(reserveSubmit).not.toHaveBeenCalled();
    expect(r.submit?.submitted).toBe(false);
  });
});
