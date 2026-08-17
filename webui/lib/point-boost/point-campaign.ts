/** RMS Item API 2.0 の pointCampaign（商品別ポイント変倍）の解析とパッチ生成（純関数）。
 * ペイロード形（要実機確認 — docs/point-boost/requirements.md §8 R1）:
 *   { pointCampaign: { applicablePeriod: { start, end }, benefits: { pointRate } } }
 * フィールド名が実機と異なる場合はこのファイルの修正だけで済むよう、
 * 解析・生成を全部ここへ集約する（item-client は素の JSON を送受するだけ）。 */

export type CurrentCampaign = {
  rate: number;
  start: string | null;
  end: string | null;
  /** end を Date 化したもの（解析不能なら null） */
  endsAt: Date | null;
};

/** items.get のレスポンス JSON から現在の変倍設定を取り出す。未設定・解析不能は null。 */
export function parsePointCampaign(itemJson: Record<string, unknown> | null): CurrentCampaign | null {
  if (!itemJson) return null;
  const pc = itemJson.pointCampaign;
  if (!pc || typeof pc !== "object") return null;
  const p = pc as {
    applicablePeriod?: { start?: unknown; end?: unknown };
    benefits?: { pointRate?: unknown };
  };
  const rateRaw = p.benefits?.pointRate;
  const rate =
    typeof rateRaw === "number" ? rateRaw : typeof rateRaw === "string" ? Number(rateRaw) : NaN;
  if (!Number.isFinite(rate) || rate < 1) return null;
  const start = typeof p.applicablePeriod?.start === "string" ? p.applicablePeriod.start : null;
  const end = typeof p.applicablePeriod?.end === "string" ? p.applicablePeriod.end : null;
  let endsAt: Date | null = null;
  if (end) {
    const d = new Date(end);
    if (!Number.isNaN(d.getTime())) endsAt = d;
  }
  return { rate: Math.floor(rate), start, end, endsAt };
}

/** 変倍設定のPATCHボディ。適用期間は now〜now+days（JST表記）。 */
export function buildBoostPatch(rate: number, now: Date, days: number): Record<string, unknown> {
  const start = floorToMinute(now);
  const end = new Date(start.getTime() + Math.max(1, days) * 24 * 60 * 60 * 1000);
  return {
    pointCampaign: {
      applicablePeriod: { start: jstIso(start), end: jstIso(end) },
      benefits: { pointRate: rate },
    },
  };
}

/** 変倍解除のPATCHボディ（pointCampaign を null で送る）。
 * API が null 解除を受け付けない場合、呼び出し側は期間満了での自然失効に委ねる。 */
export function buildClearPatch(): Record<string, unknown> {
  return { pointCampaign: null };
}

/** JST（+09:00）の ISO8601 文字列にする。RMS の日時表記に合わせる。 */
export function jstIso(d: Date): string {
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+09:00");
}

function floorToMinute(d: Date): Date {
  const t = new Date(d.getTime());
  t.setSeconds(0, 0);
  return t;
}
