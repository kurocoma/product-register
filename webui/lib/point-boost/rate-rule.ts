/** 目標ポイント倍率の決定ルール（純関数）。
 * 決定事項（docs/point-boost/requirements.md §2）: 競合最大倍率 +plus_rate、max_rate で打ち止め。
 * RMS の商品別ポイント変倍は 2〜20倍のため、2未満は「変倍しない（=1倍）」として扱う。 */

import type { PointBoostSettings } from "./types";

/** RMS 商品別ポイント変倍の設定可能範囲（2〜20倍）。 */
export const RMS_MIN_CAMPAIGN_RATE = 2;
export const RMS_MAX_CAMPAIGN_RATE = 20;

export type RateDecision = {
  /** 1 = 変倍しない（通常1倍のまま）。2以上 = pointCampaign を設定する */
  targetRate: number;
  /** 上限（max_rate）で打ち止めたか（競合に勝てていない可能性を画面で示す） */
  capped: boolean;
};

/** 競合の最大倍率から目標倍率を決める。
 * competitorMaxRate が 0/負（=情報なし）は 1倍とみなす。 */
export function decideTargetRate(
  competitorMaxRate: number,
  settings: Pick<PointBoostSettings, "plus_rate" | "max_rate">,
): RateDecision {
  const base = Math.max(1, Math.floor(competitorMaxRate) || 1);
  const plus = Math.max(1, Math.floor(settings.plus_rate) || 1);
  const cap = Math.min(Math.max(Math.floor(settings.max_rate) || 1, 1), RMS_MAX_CAMPAIGN_RATE);
  let target = base + plus;
  let capped = false;
  if (target > cap) {
    target = cap;
    capped = true;
  }
  // 上限1倍以下 = 変倍機能を実質使わない設定
  if (target < RMS_MIN_CAMPAIGN_RATE) return { targetRate: 1, capped };
  return { targetRate: target, capped };
}

/** 適用中キャンペーンの残り期間がこの時間を切ったら延長する（1日2回実行 + 1回失敗しても切れない余裕） */
export const REFRESH_REMAINING_MS = 36 * 60 * 60 * 1000;

/** いま適用中の変倍（rate, 終了日時）に対して、目標倍率での更新（PATCH）が必要か。
 * - 倍率が違う → 必要
 * - 同じでも終了が近い（REFRESH_REMAINING_MS 未満） → 延長のため必要 */
export function needsUpdate(
  current: { rate: number; endsAt: Date | null } | null,
  targetRate: number,
  now: Date,
): boolean {
  if (targetRate < RMS_MIN_CAMPAIGN_RATE) return false; // 変倍しない判断は clear 側で扱う
  if (!current || current.rate !== targetRate) return true;
  if (!current.endsAt) return true; // 期間不明なら設定し直す
  return current.endsAt.getTime() - now.getTime() < REFRESH_REMAINING_MS;
}

/** いま適用中の変倍が「実質有効」（2倍以上かつ期限内）か。解除要否の判定に使う。 */
export function isActiveCampaign(
  current: { rate: number; endsAt: Date | null } | null,
  now: Date,
): boolean {
  if (!current || current.rate < RMS_MIN_CAMPAIGN_RATE) return false;
  if (!current.endsAt) return true; // 期間不明でも倍率が入っていれば有効扱い（安全側=解除を試みる）
  return current.endsAt.getTime() > now.getTime();
}
