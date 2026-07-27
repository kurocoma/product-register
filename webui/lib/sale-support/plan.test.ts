import { describe, it, expect } from "vitest";
import {
  buildApplyPatchBody,
  buildRestorePatchBody,
  buildSsCopyBody,
  decideSsGuard,
  parsePriceValue,
  planApplySkus,
  planRestoreForItem,
  readPurchasablePeriod,
  snapshotForHistory,
  ssManageNumberFor,
} from "./plan";
import type { RakutenItemJson } from "./types";

/** 実機 items.get の形（2026-07-28 検証・実在商品 read-only 調査）に合わせた最小 JSON。 */
function itemJson(overrides: Partial<Record<string, unknown>> = {}): RakutenItemJson {
  return {
    manageNumber: "r117-1",
    title: "テスト商品",
    itemType: "NORMAL",
    payment: { taxIncluded: false, taxRate: "0.08", cashOnDeliveryFeeIncluded: false },
    variants: { "r117-1": { standardPrice: "2730" } },
    created: "2026-01-01T00:00:00+09:00",
    updated: "2026-07-01T00:00:00+09:00",
    ...overrides,
  };
}

describe("planApplySkus: 価格計算（要件定義書v1.0 の受入ケース quantity=1 相当）", () => {
  it("T01: 税抜4299・8%・割引0% → 税込4642 / 登録税抜4299 のまま", () => {
    const r = planApplySkus(
      itemJson({ variants: { v1: { standardPrice: "4299" } } }),
      0,
      false,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skus[0]).toMatchObject({
      beforeNet: 4299,
      beforeGross: 4642,
      afterNet: 4299,
      afterGross: 4642,
      targetGross: 4642,
      targetDifference: 0,
    });
  });

  it("T06: 最小額 税抜1円・8%・割引0% → 1円のまま", () => {
    const r = planApplySkus(itemJson({ variants: { v1: { standardPrice: "1" } } }), 0, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skus[0]).toMatchObject({ beforeNet: 1, beforeGross: 1, afterNet: 1, afterGross: 1 });
  });

  it("20%引き（実運用相当）: 税抜2730・8% → 税込2948 → 目標2358 → 登録税抜2184・税込2358", () => {
    const r = planApplySkus(itemJson(), 2000, false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skus[0]).toMatchObject({
      variantKey: "r117-1",
      taxPct: 8,
      beforeNet: 2730,
      beforeGross: 2948,
      targetGross: 2358,
      afterNet: 2184,
      afterGross: 2358,
      targetDifference: 0,
    });
  });

  it("T07 相当: 99.99%引きで割引後が0円になる商品は対象外にする（0円登録を送らない）", () => {
    const r = planApplySkus(
      itemJson({
        payment: { taxIncluded: false, taxRate: "0.1" },
        variants: { v1: { standardPrice: "1000" } },
      }),
      9_999,
      false,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("0円");
  });

  it("税込登録（payment.taxIncluded=true）の商品は対象外（税別登録の前提が崩れるため）", () => {
    const r = planApplySkus(itemJson({ payment: { taxIncluded: true } }), 1000, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("税込");
  });

  it("taxRate 欠落は 10% と仮定し taxAssumed=true で明示する", () => {
    const r = planApplySkus(
      itemJson({ payment: { taxIncluded: false }, variants: { v1: { standardPrice: "1000" } } }),
      1000,
      false,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taxAssumed).toBe(true);
    expect(r.skus[0].taxPct).toBe(10);
    expect(r.skus[0].beforeGross).toBe(1100);
  });

  it("多SKU: 全SKUを個別計算し、二重価格ONは各SKUの元税抜価格を referencePriceValue に持つ", () => {
    const r = planApplySkus(
      itemJson({
        variants: {
          "r117-1": { standardPrice: "2730", subscriptionPrice: { basePrice: "2457" } },
          "r117-3": { standardPrice: "7590" },
        },
      }),
      1000,
      true,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skus).toHaveLength(2);
    expect(r.skus[0].referencePriceValue).toBe(2730);
    expect(r.skus[1].referencePriceValue).toBe(7590);
    // 定期価格あり SKU の明示（確定仕様: 定期購入価格は変更しない）
    expect(r.skus[0].hasSubscription).toBe(true);
    expect(r.skus[1].hasSubscription).toBe(false);
  });

  it("価格が取得できない SKU が混ざる商品は対象外にする（部分適用しない）", () => {
    const r = planApplySkus(
      itemJson({ variants: { v1: { standardPrice: "2730" }, v2: {} } }),
      1000,
      false,
    );
    expect(r.ok).toBe(false);
  });
});

describe("buildApplyPatchBody: 最小 patch ボディ", () => {
  const period = { start: "2026-09-04T20:00:00+09:00", end: "2026-09-11T01:59:00+09:00" };

  it("purchasablePeriod（実機検証済み書式）＋ SKU別 standardPrice（文字列）を送る", () => {
    const r = planApplySkus(itemJson(), 2000, false);
    if (!r.ok) throw new Error("plan failed");
    const body = buildApplyPatchBody(r.skus, period);
    expect(body).toEqual({
      purchasablePeriod: { start: "2026-09-04T20:00:00+09:00", end: "2026-09-11T01:59:00+09:00" },
      variants: { "r117-1": { standardPrice: "2184" } },
    });
  });

  it("二重価格ONは referencePrice（REFERENCE_PRICE・既存実装と同形）に元税抜価格を設定する", () => {
    const r = planApplySkus(itemJson(), 2000, true);
    if (!r.ok) throw new Error("plan failed");
    const body = buildApplyPatchBody(r.skus, period) as {
      variants: Record<string, Record<string, unknown>>;
    };
    expect(body.variants["r117-1"].referencePrice).toEqual({
      displayType: "REFERENCE_PRICE",
      type: 1,
      value: "2730",
    });
  });
});

describe("decideSsGuard: -SS コピーの作成ガード", () => {
  it("既に -SS が存在する管理番号は対象外（上書きしない）", () => {
    const r = decideSsGuard("r117-1", true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("上書きしません");
  });

  it("-SS を付けると32文字を超える管理番号は対象外", () => {
    const r = decideSsGuard("a".repeat(30), false);
    expect(r.ok).toBe(false);
  });

  it("-SS コピー自身は対象外", () => {
    expect(decideSsGuard("r117-1-SS", false).ok).toBe(false);
  });

  it("通常の管理番号は対象（ssManageNumberFor で -SS を付ける）", () => {
    expect(decideSsGuard("r117-1", false).ok).toBe(true);
    expect(ssManageNumberFor("r117-1")).toBe("r117-1-SS");
  });
});

describe("buildSsCopyBody: -SS 倉庫コピーのボディ（実機検証 V4 の形）", () => {
  it("メタ（manageNumber/created/updated）を除き hideItem=true。他項目は保持・元 JSON は不変", () => {
    const raw = itemJson();
    const body = buildSsCopyBody(raw);
    expect(body.manageNumber).toBeUndefined();
    expect(body.created).toBeUndefined();
    expect(body.updated).toBeUndefined();
    expect(body.hideItem).toBe(true);
    expect(body.title).toBe("テスト商品");
    expect(body.variants).toEqual(raw.variants);
    // 元 JSON を破壊しない（スナップショット・履歴に使うため）
    expect(raw.manageNumber).toBe("r117-1");
    expect(raw.hideItem).toBeUndefined();
  });
});

describe("planRestoreForItem / buildRestorePatchBody: -SS からの書き戻し", () => {
  const ss = itemJson({
    manageNumber: "r117-1-SS",
    hideItem: true,
    purchasablePeriod: { start: "2026-01-01T00:00:00+09:00", end: "2026-01-05T00:00:00+09:00" },
    variants: {
      "r117-1": {
        standardPrice: "2730",
        referencePrice: { displayType: "SHOP_SETTING", value: "2730" },
      },
      "r117-3": { standardPrice: "7590" },
    },
  });
  const original = itemJson({
    variants: {
      "r117-1": {
        standardPrice: "2184",
        referencePrice: { displayType: "REFERENCE_PRICE", type: 1, value: "2730" },
      },
      "r117-3": { standardPrice: "6072" },
    },
  });

  it("価格は -SS の値へ、二重価格は -SS のオブジェクトをそのまま書き戻す（無ければ null 解除）", () => {
    const r = planRestoreForItem(ss, original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s1 = r.skus.find((s) => s.variantKey === "r117-1");
    expect(s1).toMatchObject({ currentNet: 2184, restoreNet: 2730, referenceCleared: false });
    expect(s1?.restoreReference).toEqual({ displayType: "SHOP_SETTING", value: "2730" });
    const s3 = r.skus.find((s) => s.variantKey === "r117-3");
    // -SS に referencePrice が無い → null 送信で解除（2026-07-28 実機検証 V3）
    expect(s3).toMatchObject({ restoreNet: 7590, referenceCleared: true, restoreReference: null });
    expect(r.purchasablePeriod).toEqual({
      start: "2026-01-01T00:00:00+09:00",
      end: "2026-01-05T00:00:00+09:00",
    });
    expect(r.periodCleared).toBe(false);

    const body = buildRestorePatchBody(r) as {
      purchasablePeriod: unknown;
      variants: Record<string, Record<string, unknown>>;
    };
    expect(body.variants["r117-1"]).toEqual({
      standardPrice: "2730",
      referencePrice: { displayType: "SHOP_SETTING", value: "2730" },
    });
    expect(body.variants["r117-3"]).toEqual({ standardPrice: "7590", referencePrice: null });
    // null は JSON ボディに残る（JSON Merge Patch の削除指示）
    expect(JSON.stringify(body)).toContain('"referencePrice":null');
  });

  it("-SS に販売期間が無ければ null 送信で解除する（実機検証 V2）", () => {
    const ssNoPeriod = itemJson({ manageNumber: "r117-1-SS", variants: ss.variants as Record<string, unknown> });
    const r = planRestoreForItem(ssNoPeriod, original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.purchasablePeriod).toBeNull();
    expect(r.periodCleared).toBe(true);
    const body = buildRestorePatchBody(r);
    expect(body.purchasablePeriod).toBeNull();
    expect(JSON.stringify(body)).toContain('"purchasablePeriod":null');
  });

  it("-SS に無い SKU は書き戻さず警告する（部分復元）", () => {
    const ssPartial = itemJson({
      manageNumber: "r117-1-SS",
      variants: { "r117-1": { standardPrice: "2730" } },
    });
    const r = planRestoreForItem(ssPartial, original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skus.map((s) => s.variantKey)).toEqual(["r117-1"]);
    expect(r.warnings.some((w) => w.includes("r117-3"))).toBe(true);
  });

  it("一致する SKU が無い場合は復元不可", () => {
    const ssOther = itemJson({ manageNumber: "x-SS", variants: { other: { standardPrice: "100" } } });
    const r = planRestoreForItem(ssOther, original);
    expect(r.ok).toBe(false);
  });
});

describe("補助関数", () => {
  it("parsePriceValue: 桁区切り・非数・空を安全に扱う", () => {
    expect(parsePriceValue("2,730")).toBe(2730);
    expect(parsePriceValue(2730)).toBe(2730);
    expect(parsePriceValue("")).toBeNull();
    expect(parsePriceValue("abc")).toBeNull();
    expect(parsePriceValue(undefined)).toBeNull();
  });

  it("readPurchasablePeriod: start/end が揃うときだけ返す", () => {
    expect(readPurchasablePeriod(itemJson())).toBeNull();
    expect(
      readPurchasablePeriod(
        itemJson({ purchasablePeriod: { start: "2026-08-01T10:00:00+09:00", end: "2026-08-05T09:59:59+09:00" } }),
      ),
    ).toEqual({ start: "2026-08-01T10:00:00+09:00", end: "2026-08-05T09:59:59+09:00" });
  });

  it("snapshotForHistory: 価格・二重価格・期間・定期の要点だけを残す", () => {
    const snap = snapshotForHistory(
      itemJson({
        variants: {
          v1: {
            standardPrice: "2730",
            referencePrice: { displayType: "REFERENCE_PRICE", type: 1, value: "3000" },
            subscriptionPrice: { basePrice: "2457" },
            attributes: [{ name: "大きい属性", values: ["x"] }],
          },
        },
      }),
    );
    expect(snap).toMatchObject({
      title: "テスト商品",
      hideItem: false,
      purchasablePeriod: null,
      variants: {
        v1: {
          standardPrice: "2730",
          referencePrice: { displayType: "REFERENCE_PRICE", type: 1, value: "3000" },
          subscriptionPrice: { basePrice: "2457" },
        },
      },
    });
    // 属性など巨大フィールドはスナップショットに含めない（-SS コピーが完全な控え）
    expect(JSON.stringify(snap)).not.toContain("大きい属性");
  });
});
