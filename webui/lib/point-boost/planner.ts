/** 商品1件の実行計画（純関数）。SKU別の競合リストと現在の変倍状態から、
 * 「変倍する/解除する/何もしない」と目標倍率を決める。IOはしない（service.ts が呼ぶ）。 */

import { competitorMaxRate } from "./matcher";
import { decideTargetRate, isActiveCampaign, needsUpdate } from "./rate-rule";
import type { CurrentCampaign } from "./point-campaign";
import type { Competitor, PointBoostAction, PointBoostSettings } from "./types";

export type SkuCompetitors = {
  /** 使った検索キーワード（JAN or 商品名） */
  keyword: string;
  keywordType: "jan" | "name";
  /** 価格帯ガード等を通過した競合（価格昇順） */
  competitors: Competitor[];
};

export type ProductPlan = {
  action: Extract<PointBoostAction, "boosted" | "cleared" | "unchanged" | "no_competitor">;
  /** 1 = 変倍しない、2以上 = 設定すべき倍率 */
  targetRate: number;
  capped: boolean;
  competitorMax: number | null;
  detail: string;
};

/** SKU別競合と現在の変倍から商品のアクションを決める。 */
export function planProduct(
  skuCompetitors: SkuCompetitors[],
  current: CurrentCampaign | null,
  settings: PointBoostSettings,
  now: Date,
): ProductPlan {
  const rates = skuCompetitors
    .map((s) => competitorMaxRate(s.competitors, settings.compare_top_n))
    .filter((r): r is number => r !== null);

  // 有効な競合が1件も見つからない → 現状維持（誤って解除もしない: 安全側）
  if (rates.length === 0) {
    const note = isActiveCampaign(toRateEnd(current), now)
      ? `競合が見つからないため現在の${current!.rate}倍を維持します（期間満了で自然失効）`
      : "有効な競合が見つかりませんでした";
    return { action: "no_competitor", targetRate: 1, capped: false, competitorMax: null, detail: note };
  }

  const competitorMax = Math.max(...rates);
  const { targetRate, capped } = decideTargetRate(competitorMax, settings);

  if (targetRate >= 2) {
    if (needsUpdate(toRateEnd(current), targetRate, now)) {
      const cappedNote = capped
        ? `（競合${competitorMax}倍に対し上限${settings.max_rate}倍で打ち止め）`
        : "";
      return {
        action: "boosted",
        targetRate,
        capped,
        competitorMax,
        detail: `競合最大${competitorMax}倍 → ${targetRate}倍を${settings.campaign_days}日間適用${cappedNote}`,
      };
    }
    return {
      action: "unchanged",
      targetRate,
      capped,
      competitorMax,
      detail: `既に${targetRate}倍で適用中（終了: ${current?.end ?? "不明"}）`,
    };
  }

  // 変倍不要（競合に勝つのに2倍未満で足りる）。適用中なら解除する
  if (isActiveCampaign(toRateEnd(current), now)) {
    return {
      action: "cleared",
      targetRate: 1,
      capped,
      competitorMax,
      detail: `競合最大${competitorMax}倍のため変倍不要 → 解除します（現在${current!.rate}倍）`,
    };
  }
  return {
    action: "unchanged",
    targetRate: 1,
    capped,
    competitorMax,
    detail: `競合最大${competitorMax}倍のため変倍不要（現在も未設定）`,
  };
}

function toRateEnd(c: CurrentCampaign | null): { rate: number; endsAt: Date | null } | null {
  return c ? { rate: c.rate, endsAt: c.endsAt } : null;
}
