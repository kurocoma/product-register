import { describe, it, expect, vi } from "vitest";
import {
  buildApplyPlans,
  buildRestorePlans,
  executeApply,
  executeRestore,
  type SaleSupportDeps,
} from "./service";
import type { RakutenItemJson, SalePeriod } from "./types";

const PERIOD: SalePeriod = { start: "2026-09-04T20:00:00+09:00", end: "2026-09-11T01:59:00+09:00" };
const OPTS = { discountBp: 2000, period: PERIOD, dualPrice: true, delayMs: 0 };

/** RMS の JSON Merge Patch 相当（null=削除・オブジェクトは再帰マージ）。実機挙動の最小模倣。 */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete target[k];
    } else if (typeof v === "object" && !Array.isArray(v)) {
      target[k] = mergePatch(
        { ...((target[k] ?? {}) as Record<string, unknown>) },
        v as Record<string, unknown>,
      );
    } else {
      target[k] = v;
    }
  }
  return target;
}

function baseItem(): RakutenItemJson {
  return {
    manageNumber: "r117-1",
    title: "テスト商品",
    itemType: "NORMAL",
    payment: { taxIncluded: false, taxRate: "0.08" },
    variants: {
      "r117-1": { standardPrice: "2730", subscriptionPrice: { basePrice: "2457" } },
      "r117-3": { standardPrice: "7590" },
    },
    created: "2026-01-01T00:00:00+09:00",
    updated: "2026-07-01T00:00:00+09:00",
  };
}

/** インメモリ RMS ＋ 呼び出し記録つきの fake deps。 */
function makeFake(store: Record<string, RakutenItemJson>) {
  const calls: { op: string; mn: string; body?: Record<string, unknown> }[] = [];
  const history: { productId: string | null; detail: Record<string, unknown> }[] = [];
  const savedCopies: string[] = [];
  const deletedRows: string[] = [];
  const deps: SaleSupportDeps = {
    getItem: async (mn) => {
      calls.push({ op: "get", mn });
      const json = store[mn];
      return json
        ? { exists: true, status: 200, json: structuredClone(json) }
        : { exists: false, status: 404, json: null };
    },
    upsertItem: async (mn, body) => {
      calls.push({ op: "upsert", mn, body });
      store[mn] = structuredClone(body) as RakutenItemJson;
      return { ok: true, status: 201 };
    },
    patchItem: async (mn, body) => {
      calls.push({ op: "patch", mn, body });
      if (!store[mn]) return { ok: false, status: 404, message: "not found" };
      mergePatch(store[mn] as Record<string, unknown>, structuredClone(body));
      return { ok: true, status: 204 };
    },
    deleteItem: async (mn) => {
      calls.push({ op: "delete", mn });
      delete store[mn];
      return { ok: true, status: 204 };
    },
    saveSsCopy: async (ssMn) => {
      savedCopies.push(ssMn);
      return { ok: true };
    },
    findProductId: async () => "prod-1",
    deleteSsRow: async (ssMn) => {
      deletedRows.push(ssMn);
      return { ok: true };
    },
    recordHistory: async (productId, detail) => {
      history.push({ productId, detail });
    },
    sleep: async () => {},
  };
  return { deps, calls, history, savedCopies, deletedRows, store };
}

describe("buildApplyPlans: プレビュー＝実行値の一致（payloadHash）", () => {
  it("楽天側が不変なら hash は一致し、価格が変わると hash が変わる（409 の根拠）", async () => {
    const { deps, store } = makeFake({ "r117-1": baseItem() });
    const first = await buildApplyPlans(deps, ["r117-1"], OPTS);
    const second = await buildApplyPlans(deps, ["r117-1"], OPTS);
    expect(first.payloadHash).toBe(second.payloadHash);

    (store["r117-1"].variants as Record<string, Record<string, unknown>>)["r117-1"].standardPrice = "2731";
    const third = await buildApplyPlans(deps, ["r117-1"], OPTS);
    expect(third.payloadHash).not.toBe(first.payloadHash);
  });

  it("オプション（値引き％・期間・二重価格）が変わると hash が変わる", async () => {
    const { deps } = makeFake({ "r117-1": baseItem() });
    const a = await buildApplyPlans(deps, ["r117-1"], OPTS);
    const b = await buildApplyPlans(deps, ["r117-1"], { ...OPTS, discountBp: 1000 });
    const c = await buildApplyPlans(deps, ["r117-1"], { ...OPTS, dualPrice: false });
    expect(b.payloadHash).not.toBe(a.payloadHash);
    expect(c.payloadHash).not.toBe(a.payloadHash);
  });

  it("既に -SS コピーがある商品は excluded（上書きしない・-SS 重複ガード）", async () => {
    const { deps } = makeFake({
      "r117-1": baseItem(),
      "r117-1-SS": { ...baseItem(), manageNumber: "r117-1-SS", hideItem: true },
    });
    const { plans } = await buildApplyPlans(deps, ["r117-1"], OPTS);
    expect(plans[0].status).toBe("excluded");
    expect(plans[0].reason).toContain("上書きしません");
  });

  it("楽天に無い管理番号は failed、他の商品は継続する", async () => {
    const { deps } = makeFake({ "r117-1": baseItem() });
    const { plans } = await buildApplyPlans(deps, ["nashi-1", "r117-1"], OPTS);
    expect(plans[0].status).toBe("failed");
    expect(plans[1].status).toBe("plan");
  });

  it("items.get の 429（QPS制限）は『見つかりません』ではなく取得失敗として failed にする", async () => {
    const { deps } = makeFake({});
    const limited: SaleSupportDeps = {
      ...deps,
      getItem: async () => ({ exists: false, status: 429, json: null }),
    };
    const { plans } = await buildApplyPlans(limited, ["r117-1"], OPTS);
    expect(plans[0].status).toBe("failed");
    expect(plans[0].reason).toContain("HTTP 429");
    expect(plans[0].reason).not.toContain("見つかりません");
  });

  it("-SS の存在確認が 429 のときは（無い扱いで上書きせず）failed にする", async () => {
    const { deps } = makeFake({ "r117-1": baseItem() });
    const limited: SaleSupportDeps = {
      ...deps,
      getItem: async (mn) => {
        if (mn === "r117-1-SS") return { exists: false, status: 429, json: null };
        return deps.getItem(mn);
      },
    };
    const { plans } = await buildApplyPlans(limited, ["r117-1"], OPTS);
    expect(plans[0].status).toBe("failed");
    expect(plans[0].reason).toContain("存在確認");
  });

  it("getItem が throw しても当該商品 failed で継続する（per-call タイムアウト想定）", async () => {
    const { deps } = makeFake({ "r117-1": baseItem() });
    const flaky: SaleSupportDeps = {
      ...deps,
      getItem: async (mn) => {
        if (mn === "timeout-1") throw new Error("タイムアウト(30000ms): items.get timeout-1");
        return deps.getItem(mn);
      },
    };
    const { plans } = await buildApplyPlans(flaky, ["timeout-1", "r117-1"], OPTS);
    expect(plans[0].status).toBe("failed");
    expect(plans[0].reason).toContain("タイムアウト");
    expect(plans[1].status).toBe("plan");
  });
});

describe("executeApply: 実行順序と結果", () => {
  it("-SSコピー作成 → DB保存 → 元商品patch → 読み戻し検証 → 履歴。patch はプレビューと同一ボディ", async () => {
    const { deps, calls, history, savedCopies, store } = makeFake({ "r117-1": baseItem() });
    const { plans } = await buildApplyPlans(deps, ["r117-1"], OPTS);
    const results = await executeApply(deps, plans, OPTS);

    expect(results[0].status).toBe("ok");
    expect(results[0].verified).toBe(true);

    // 書き込み順: upsert(-SS) が patch(元商品) より先（元価格の控えを先に確保）
    const writeOps = calls.filter((c) => c.op !== "get").map((c) => `${c.op}:${c.mn}`);
    expect(writeOps).toEqual(["upsert:r117-1-SS", "patch:r117-1"]);

    // patch ボディはプレビューの patchBody と完全一致（プレビュー＝実行値）
    const patchCall = calls.find((c) => c.op === "patch");
    expect(patchCall?.body).toEqual(plans[0].patchBody);

    // -SS コピー: 元価格のまま・倉庫・メタ除去
    const ss = store["r117-1-SS"] as Record<string, unknown>;
    expect(ss.hideItem).toBe(true);
    expect(ss.manageNumber).toBeUndefined();
    expect((ss.variants as Record<string, Record<string, unknown>>)["r117-1"].standardPrice).toBe("2730");
    expect(savedCopies).toEqual(["r117-1-SS"]);

    // 元商品: 20%引き（2730→2184 / 7590→6072）＋二重価格＋販売期間
    const orig = store["r117-1"] as Record<string, unknown>;
    const v = orig.variants as Record<string, Record<string, unknown>>;
    expect(v["r117-1"].standardPrice).toBe("2184");
    expect(v["r117-3"].standardPrice).toBe("6072");
    expect(v["r117-1"].referencePrice).toEqual({ displayType: "REFERENCE_PRICE", type: 1, value: "2730" });
    expect(orig.purchasablePeriod).toEqual(PERIOD);
    // 定期購入価格は変更しない（確定仕様）
    expect(v["r117-1"].subscriptionPrice).toEqual({ basePrice: "2457" });

    // 履歴: スナップショット＋実行内容
    expect(history).toHaveLength(1);
    expect(history[0].productId).toBe("prod-1");
    expect(history[0].detail).toMatchObject({
      kind: "sale_support_apply",
      manage_number: "r117-1",
      ss_manage_number: "r117-1-SS",
      result_status: "ok",
    });
    const snap = history[0].detail.snapshot as Record<string, unknown>;
    expect((snap.variants as Record<string, Record<string, unknown>>)["r117-1"].standardPrice).toBe("2730");
  });

  it("-SS コピー作成に失敗したら元商品に触れない", async () => {
    const { deps, calls } = makeFake({ "r117-1": baseItem() });
    const failing: SaleSupportDeps = {
      ...deps,
      upsertItem: async (mn, body) => {
        calls.push({ op: "upsert", mn, body });
        return { ok: false, status: 400, message: "IE9999: だめ" };
      },
    };
    const { plans } = await buildApplyPlans(failing, ["r117-1"], OPTS);
    const results = await executeApply(failing, plans, OPTS);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("元商品は変更していません");
    expect(calls.some((c) => c.op === "patch")).toBe(false);
  });

  it("アプリDBへの -SS 行保存失敗は警告として続行する（RMS 上のコピーが正）", async () => {
    const { deps } = makeFake({ "r117-1": baseItem() });
    const flaky: SaleSupportDeps = {
      ...deps,
      saveSsCopy: async () => ({ ok: false, error: "DBエラー" }),
    };
    const { plans } = await buildApplyPlans(flaky, ["r117-1"], OPTS);
    const results = await executeApply(flaky, plans, OPTS);
    expect(results[0].status).toBe("ok");
    expect(results[0].warnings.some((w) => w.includes("復元一覧"))).toBe(true);
  });

  it("patch 失敗は failed（-SS 作成済みの旨を案内）で他商品へ継続する", async () => {
    const store = { "r117-1": baseItem(), "r118-1": { ...baseItem(), manageNumber: "r118-1" } };
    const { deps, calls } = makeFake(store);
    const failing: SaleSupportDeps = {
      ...deps,
      patchItem: async (mn, body) => {
        if (mn === "r117-1") return { ok: false, status: 400, message: "IE0430: 定期割引違反" };
        return deps.patchItem(mn, body);
      },
    };
    const { plans } = await buildApplyPlans(failing, ["r117-1", "r118-1"], OPTS);
    const results = await executeApply(failing, plans, OPTS);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("-SS コピーは作成済み");
    expect(results[1].status).toBe("ok");
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(2);
  });

  it("plan 以外（excluded/failed）の項目は書き込みを行わずそのまま結果化する", async () => {
    const { deps, calls } = makeFake({
      "r117-1": baseItem(),
      "r117-1-SS": { ...baseItem(), manageNumber: "r117-1-SS" },
    });
    const { plans } = await buildApplyPlans(deps, ["r117-1"], OPTS);
    const results = await executeApply(deps, plans, OPTS);
    expect(results[0].status).toBe("excluded");
    expect(calls.filter((c) => c.op !== "get")).toHaveLength(0);
  });
});

describe("復元（-SS コピーから書き戻し）", () => {
  /** セール適用済みの状態を作る（-SS = 元値の控え / 元商品 = 値引き済み）。 */
  async function applied() {
    const fake = makeFake({ "r117-1": baseItem() });
    const { plans } = await buildApplyPlans(fake.deps, ["r117-1"], OPTS);
    await executeApply(fake.deps, plans, OPTS);
    fake.calls.length = 0;
    fake.history.length = 0;
    return fake;
  }

  it("プレビュー: 価格・二重価格の解除・販売期間の解除を -SS の値どおりに計画する", async () => {
    const fake = await applied();
    const { plans, payloadHash } = await buildRestorePlans(fake.deps, ["r117-1-SS"], { delayMs: 0 });
    expect(plans[0].status).toBe("plan");
    expect(payloadHash).toMatch(/^[0-9a-f]{64}$/);
    const skus = plans[0].skus ?? [];
    expect(skus.find((s) => s.variantKey === "r117-1")).toMatchObject({
      currentNet: 2184,
      restoreNet: 2730,
      referenceCleared: true, // 適用前の元商品に二重価格が無かった → null 解除（実機検証 V3）
    });
    expect(plans[0].periodCleared).toBe(true); // 適用前は販売期間なし → null 解除（実機検証 V2）
  });

  it("実行: 書き戻し＋読み戻し検証＋「削除する」選択で -SS を削除する", async () => {
    const fake = await applied();
    const { plans } = await buildRestorePlans(fake.deps, ["r117-1-SS"], { delayMs: 0 });
    const results = await executeRestore(fake.deps, plans, { deleteCopy: true, delayMs: 0 });
    expect(results[0].status).toBe("ok");
    expect(results[0].verified).toBe(true);

    const orig = fake.store["r117-1"] as Record<string, unknown>;
    const v = orig.variants as Record<string, Record<string, unknown>>;
    expect(v["r117-1"].standardPrice).toBe("2730");
    expect(v["r117-3"].standardPrice).toBe("7590");
    expect(v["r117-1"].referencePrice).toBeUndefined(); // null 送信で解除
    expect(orig.purchasablePeriod).toBeUndefined(); // null 送信で解除

    expect(fake.store["r117-1-SS"]).toBeUndefined(); // -SS 削除
    expect(fake.deletedRows).toEqual(["r117-1-SS"]); // アプリDB行も削除
    expect(fake.history[0].detail).toMatchObject({ kind: "sale_support_restore", result_status: "ok" });
  });

  it("「残す」選択では -SS を削除しない", async () => {
    const fake = await applied();
    const { plans } = await buildRestorePlans(fake.deps, ["r117-1-SS"], { delayMs: 0 });
    const results = await executeRestore(fake.deps, plans, { deleteCopy: false, delayMs: 0 });
    expect(results[0].status).toBe("ok");
    expect(fake.store["r117-1-SS"]).toBeDefined();
    expect(fake.deletedRows).toEqual([]);
  });

  it("書き戻しに失敗した商品は -SS を削除しない", async () => {
    const fake = await applied();
    const failing: SaleSupportDeps = {
      ...fake.deps,
      patchItem: async () => ({ ok: false, status: 400, message: "だめ" }),
    };
    const { plans } = await buildRestorePlans(failing, ["r117-1-SS"], { delayMs: 0 });
    const results = await executeRestore(failing, plans, { deleteCopy: true, delayMs: 0 });
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toContain("-SS コピーは残しています");
    expect(fake.store["r117-1-SS"]).toBeDefined();
  });

  it("-SS 以外の管理番号・存在しない -SS は failed", async () => {
    const fake = await applied();
    const { plans } = await buildRestorePlans(fake.deps, ["r117-1", "nashi-SS"], { delayMs: 0 });
    expect(plans[0].status).toBe("failed"); // -SS で終わらない
    expect(plans[1].status).toBe("failed"); // 楽天に無い
  });

  it("プレビュー後に楽天側が変わると hash が変わる（409 の根拠）", async () => {
    const fake = await applied();
    const first = await buildRestorePlans(fake.deps, ["r117-1-SS"], { delayMs: 0 });
    (
      (fake.store["r117-1-SS"].variants as Record<string, Record<string, unknown>>)["r117-1"]
    ).standardPrice = "9999";
    const second = await buildRestorePlans(fake.deps, ["r117-1-SS"], { delayMs: 0 });
    expect(second.payloadHash).not.toBe(first.payloadHash);
  });
});

describe("履歴とスナップショット", () => {
  it("recordHistory が失敗しても結果は返り、警告に載る", async () => {
    const { deps } = makeFake({ "r117-1": baseItem() });
    const flaky: SaleSupportDeps = {
      ...deps,
      recordHistory: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    const { plans } = await buildApplyPlans(flaky, ["r117-1"], OPTS);
    const results = await executeApply(flaky, plans, OPTS);
    expect(results[0].status).toBe("ok");
    expect(results[0].warnings.some((w) => w.includes("履歴"))).toBe(true);
  });
});
