/** 商品1件の実行計画（純関数）。SKU別の競合リストと現在の変倍状態から、
 * 「変倍する/何もしない」と目標倍率を決める。IOはしない（service.ts が呼ぶ）。
 *
 * 安全側の原則（レビュー確定事項）:
 * - 開始前の予約キャンペーン（手動設定）には一切触らない
 * - 現在の倍率が目標より高いときは下げない（手動設定の可能性。期間満了で自然失効）
 * - 自動での「解除PATCH」はしない（誤発動で手動キャンペーンを消すリスク > 数日の原資）。
 *   変倍を止めたいときは期間満了の自然失効に委ねる */

import { competitorMaxRate } from "./matcher";
import { decideTargetRate, isActiveCampaign, needsUpdate, RMS_MIN_CAMPAIGN_RATE } from "./rate-rule";
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
  action: Extract<PointBoostAction, "boosted" | "unchanged" | "no_competitor">;
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
  // 開始前の予約キャンペーン（手動設定）には触らない
  if (current?.startsAt && current.startsAt.getTime() > now.getTime()) {
    return {
      action: "unchanged", targetRate: current.rate, capped: false, competitorMax: null,
      detail: `開始前の予約キャンペーン（${current.rate}倍・開始 ${current.start}）があるため何もしません`,
    };
  }

  const rates = skuCompetitors
    .map((s) => competitorMaxRate(s.competitors, settings.compare_top_n))
    .filter((r): r is number => r !== null);

  // 有効な競合が1件も見つからない → 現状維持（誤って触らない: 安全側）
  if (rates.length === 0) {
    const note = isActiveCampaign(toRateEnd(current), now)
      ? `競合が見つからないため現在の${current!.rate}倍を維持します（期間満了で自然失効）`
      : "有効な競合が見つかりませんでした";
    return { action: "no_competitor", targetRate: 1, capped: false, competitorMax: null, detail: note };
  }

  const competitorMax = Math.max(...rates);
  const { targetRate, capped } = decideTargetRate(competitorMax, settings);

  if (targetRate >= RMS_MIN_CAMPAIGN_RATE) {
    // 降格ガード: 現在の倍率が目標より高ければ下げない（手動設定の可能性）
    if (isActiveCampaign(toRateEnd(current), now) && current!.rate > targetRate) {
      return {
        action: "unchanged", targetRate, capped, competitorMax,
        detail: `現在の${current!.rate}倍が目標${targetRate}倍より高いため維持します（手動設定の可能性。期間満了で自然失効）`,
      };
    }
    if (needsUpdate(toRateEnd(current), targetRate, now)) {
      const cappedNote = capped
        ? `（競合${competitorMax}倍に対し上限${settings.max_rate}倍で打ち止め）`
        : "";
      return {
        action: "boosted", targetRate, capped, competitorMax,
        detail: `競合最大${competitorMax}倍 → ${targetRate}倍を${settings.campaign_days}日間適用${cappedNote}`,
      };
    }
    return {
      action: "unchanged", targetRate, capped, competitorMax,
      detail: `既に${targetRate}倍で適用中（終了: ${current?.end ?? "不明"}）`,
    };
  }

  // 上限倍率が1倍以下の設定 = 変倍を使わない。解除PATCHはせず自然失効に委ねる
  const activeNote = isActiveCampaign(toRateEnd(current), now)
    ? `（適用中の${current!.rate}倍は期間満了で自然失効します）`
    : "";
  return {
    action: "unchanged", targetRate: 1, capped, competitorMax,
    detail: `上限倍率の設定により変倍しません${activeNote}`,
  };
}

function toRateEnd(c: CurrentCampaign | null): { rate: number; endsAt: Date | null } | null {
  return c ? { rate: c.rate, endsAt: c.endsAt } : null;
}
