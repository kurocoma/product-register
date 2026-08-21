/** RMS Item API 2.0 の pointCampaign（商品別ポイント変倍）の解析とパッチ生成（純関数）。
 * ペイロード形（要実機確認 — docs/point-boost/requirements.md §8 R1）:
 *   { pointCampaign: { applicablePeriod: { start, end }, benefits: { pointRate } } }
 * フィールド名が実機と異なる場合はこのファイルの修正だけで済むよう、
 * 解析・生成を全部ここへ集約する（item-client は素の JSON を送受するだけ）。 */

export type CurrentCampaign = {
  rate: number;
  start: string | null;
  end: string | null;
  /** start/end を Date 化したもの（解析不能なら null）。
   * startsAt が未来 = 手動予約されたキャンペーン（planner はこれに触らない） */
  startsAt: Date | null;
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
  return { rate: Math.floor(rate), start, end, startsAt: toDate(start), endsAt: toDate(end) };
}

/** 変倍を適用する時間帯の窓（JSTの「時」・2026-08-21 ユーザー決定の3区切り運用）。
 * - 昼帯 9:00〜17:59:59 ／ 夜帯 20:00〜23:59:59（endHour を送ると RMS が xx:59:59 へ変換する）
 * - 窓の外（深夜 0:00〜8:59）には変倍を一切置かない＝必ず1倍（売れない時間帯に原資を使わない）
 * - 各窓の終了は次の定期実行（6:45/17:45 — scripts/register-point-boost-task.bat の TIME1/TIME2）より
 *   前に来るため、「適用期間中は更新も解除も不可（IE0154・実機確認済み）」の制約下でも
 *   毎回の実行で再評価・再設定できる。**bat の実行時刻を変えるときはここも合わせること**
 *   （各窓の startHour は実行時刻+2時間超の正時である必要がある: IE0173） */
const CAMPAIGN_WINDOWS_JST = [
  { startHour: 9, endHour: 17 },
  { startHour: 20, endHour: 23 },
];

/** 変倍設定のPATCHボディ。適用期間は「now+2時間超の次の正時」以降に入れる最初の窓（JST表記。
 * days は上限日数として維持するが、窓の終了が必ず先に来るため実質窓区切りになる）。
 * RMS の制約（2026-08-20/21 実機確認 + docs/楽天/items.patch.txt）:
 * - start は「時」までが有効で、00分00秒以外は自動的に00分00秒へ切り捨てられる
 *   （分単位を送ると丸め後に過去となり IE0121 で拒否される）
 * - 開始が現在から2時間以内は IE0173、60日以降は IE0259 で拒否 */
export function buildBoostPatch(rate: number, now: Date, days: number): Record<string, unknown> {
  const earliest = ceilToJstHour(new Date(now.getTime() + (2 * 60 + 1) * 60 * 1000));
  const w = pickWindow(earliest);
  const capEnd = new Date(w.start.getTime() + Math.max(1, days) * 24 * 60 * 60 * 1000);
  const end = w.end.getTime() < capEnd.getTime() ? w.end : capEnd;
  return {
    pointCampaign: {
      applicablePeriod: { start: jstIso(w.start), end: jstIso(end) },
      benefits: { pointRate: rate },
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** earliest（JST正時）以降に開始できる最初の窓を返す。窓の途中なら earliest 開始で残り区間だけ使う。
 * 窓終了ちょうど（start==end）は避けて次の窓へ回す。当日に窓が残っていなければ翌日の最初の窓。 */
function pickWindow(earliest: Date): { start: Date; end: Date } {
  // earliest が属する JST 日付の 0:00（UTC表現）
  const jstMidnight = new Date(Math.floor((earliest.getTime() + 9 * HOUR_MS) / DAY_MS) * DAY_MS - 9 * HOUR_MS);
  for (const dayOffset of [0, 1]) {
    for (const w of CAMPAIGN_WINDOWS_JST) {
      const wStart = new Date(jstMidnight.getTime() + dayOffset * DAY_MS + w.startHour * HOUR_MS);
      const wEnd = new Date(jstMidnight.getTime() + dayOffset * DAY_MS + w.endHour * HOUR_MS);
      if (earliest.getTime() < wEnd.getTime()) {
        return { start: earliest.getTime() > wStart.getTime() ? earliest : wStart, end: wEnd };
      }
    }
  }
  // 翌日の窓が必ずヒットするため到達しない（型を満たすためのフォールバック）
  return { start: earliest, end: new Date(earliest.getTime() + HOUR_MS) };
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

/** JST の次の正時（00分00秒）へ切り上げる。JST は UTC と分単位が一致するため UTC 演算でよい。 */
function ceilToJstHour(d: Date): Date {
  const t = new Date(d.getTime());
  t.setUTCMinutes(0, 0, 0);
  if (t.getTime() < d.getTime()) t.setTime(t.getTime() + 60 * 60 * 1000);
  return t;
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
