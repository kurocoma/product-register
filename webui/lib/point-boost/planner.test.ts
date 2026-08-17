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

const campaign = (rate: number, endsInMs: number, startsInMs = -1000): CurrentCampaign => ({
  rate,
  start: new Date(now.getTime() + startsInMs).toISOString(),
  end: new Date(now.getTime() + endsInMs).toISOString(),
  startsAt: new Date(now.getTime() + startsInMs),
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

  it("競合ゼロなら現状維持（誤って触らない）", () => {
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

  it("降格ガード: 現在の倍率が目標より高ければ下げない（手動設定の可能性）", () => {
    const plan = planProduct([sku([1])], campaign(5, 5 * 24 * 3600 * 1000), settings, now);
    expect(plan.action).toBe("unchanged");
    expect(plan.detail).toContain("5倍が目標2倍より高い");
  });

  it("開始前の予約キャンペーンには一切触らない", () => {
    const reserved = campaign(10, 10 * 24 * 3600 * 1000, 2 * 24 * 3600 * 1000); // 2日後開始
    const plan = planProduct([sku([1])], reserved, settings, now);
    expect(plan.action).toBe("unchanged");
    expect(plan.detail).toContain("予約キャンペーン");
  });

  it("上限1倍設定では解除PATCHせず自然失効に委ねる", () => {
    const plan = planProduct(
      [sku([1])],
      campaign(2, 5 * 24 * 3600 * 1000),
      { ...settings, max_rate: 1 },
      now,
    );
    expect(plan.action).toBe("unchanged");
    expect(plan.targetRate).toBe(1);
    expect(plan.detail).toContain("自然失効");
  });

  it("上限1倍設定で未設定なら unchanged", () => {
    const plan = planProduct([sku([1])], null, { ...settings, max_rate: 1 }, now);
    expect(plan.action).toBe("unchanged");
    expect(plan.targetRate).toBe(1);
  });
});
