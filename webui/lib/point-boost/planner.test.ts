import { describe, expect, it } from "vitest";
import { planProduct, type SkuCompetitors } from "./planner";
import type { CurrentCampaign } from "./point-campaign";
import { DEFAULT_POINT_BOOST_SETTINGS } from "./types";

const now = new Date("2026-08-17T00:00:00Z");
const settings = { ...DEFAULT_POINT_BOOST_SETTINGS, enabled: true };

const sku = (rates: number[], keyword = "4900000000001"): SkuCompetitors => ({
  keyword,
  keywordType: "jan",
  competitors: rates.map((pointRate, i) => ({
    shopCode: `shop-${keyword}-${i}`,
    shopName: `店${i}`,
    itemName: "テスト商品",
    itemPrice: 1000 + i,
    pointRate,
    itemUrl: "",
  })),
});

const campaign = (rate: number, endsInMs: number): CurrentCampaign => ({
  rate,
  start: null,
  end: new Date(now.getTime() + endsInMs).toISOString(),
  endsAt: new Date(now.getTime() + endsInMs),
});

describe("planProduct", () => {
  it("他店1倍・未設定 → 2倍に変倍（依頼の基本例）", () => {
    const plan = planProduct([sku([1, 1, 1])], null, settings, now);
    expect(plan.action).toBe("boosted");
    expect(plan.targetRate).toBe(2);
    expect(plan.competitorMax).toBe(1);
  });

  it("複数SKUでは最大の競合倍率を使う", () => {
    const plan = planProduct([sku([1], "4900000000001"), sku([2], "4900000000002")], null, settings, now);
    expect(plan.action).toBe("boosted");
    expect(plan.targetRate).toBe(3);
    expect(plan.competitorMax).toBe(2);
  });

  it("既に目標倍率・期間十分なら unchanged", () => {
    const plan = planProduct([sku([1])], campaign(2, 5 * 24 * 3600 * 1000), settings, now);
    expect(plan.action).toBe("unchanged");
  });

  it("同じ倍率でも期限が近ければ延長（boosted）", () => {
    const plan = planProduct([sku([1])], campaign(2, 3600 * 1000), settings, now);
    expect(plan.action).toBe("boosted");
    expect(plan.targetRate).toBe(2);
  });

  it("競合ゼロなら現状維持（誤って解除しない）", () => {
    const plan = planProduct([sku([])], campaign(2, 5 * 24 * 3600 * 1000), settings, now);
    expect(plan.action).toBe("no_competitor");
    expect(plan.detail).toContain("2倍を維持");
  });

  it("上限打ち止めは capped として通知される", () => {
    const plan = planProduct([sku([5])], null, settings, now);
    expect(plan.action).toBe("boosted");
    expect(plan.targetRate).toBe(3);
    expect(plan.capped).toBe(true);
    expect(plan.detail).toContain("上限3倍で打ち止め");
  });

  it("上限1倍設定で適用中の変倍があれば解除（cleared）", () => {
    const plan = planProduct(
      [sku([1])],
      campaign(2, 5 * 24 * 3600 * 1000),
      { ...settings, max_rate: 1 },
      now,
    );
    expect(plan.action).toBe("cleared");
    expect(plan.targetRate).toBe(1);
  });

  it("上限1倍設定で未設定なら unchanged", () => {
    const plan = planProduct([sku([1])], null, { ...settings, max_rate: 1 }, now);
    expect(plan.action).toBe("unchanged");
    expect(plan.targetRate).toBe(1);
  });
});
