import type { SalePeriod } from "./types";

/** datetime-local（"YYYY-MM-DDTHH:mm" / 秒付き）の受理パターン。 */
const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/;
/** 楽天 purchasablePeriod の確定書式（2026-07-28 実機検証: patch→getItem で同一書式が往復）。 */
const RAKUTEN_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;

/**
 * 画面入力（datetime-local）を楽天 purchasablePeriod の書式へ変換する。
 * "2026-08-01T10:00" → "2026-08-01T10:00:00+09:00"（JST固定。RMS は日本時間運用）。
 * 既に確定書式ならそのまま返す。不正・実在しない日時は null。
 */
export function toRakutenDateTime(input: string): string | null {
  const t = input.trim();
  if (t === "") return null;
  if (RAKUTEN_DATETIME_RE.test(t)) {
    return Number.isNaN(Date.parse(t)) ? null : t;
  }
  const m = t.match(LOCAL_RE);
  if (!m) return null;
  const composed = `${m[1]}T${m[2]}:${m[3] ?? "00"}+09:00`;
  return Number.isNaN(Date.parse(composed)) ? null : composed;
}

/** 販売期間の入力を検証して確定書式の SalePeriod にする（開始 < 終了 必須）。 */
export function validateSalePeriod(
  startRaw: string,
  endRaw: string,
): { ok: true; period: SalePeriod } | { ok: false; error: string } {
  const start = toRakutenDateTime(startRaw);
  if (!start) return { ok: false, error: "販売期間の開始日時が不正です（例: 2026-09-04T20:00）" };
  const end = toRakutenDateTime(endRaw);
  if (!end) return { ok: false, error: "販売期間の終了日時が不正です（例: 2026-09-11T01:59）" };
  if (Date.parse(start) >= Date.parse(end)) {
    return { ok: false, error: "販売期間は開始日時 < 終了日時にしてください" };
  }
  return { ok: true, period: { start, end } };
}

/**
 * 値引き％（例 20 / 5.5。小数第2位まで）→ bp（0.01%単位。5.00% = 500）。
 * セール適用の入力検証用: 0.01〜99.99% のみ受理（0% と 100% 以上は不可）。
 */
export function discountPercentToBp(percent: number): number | null {
  if (!Number.isFinite(percent)) return null;
  const bp = Math.round(percent * 100);
  if (Math.abs(percent * 100 - bp) > 1e-6) return null; // 小数第3位以下は誤入力として拒否
  if (bp < 1 || bp > 9_999) return null;
  return bp;
}
