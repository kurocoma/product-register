/** 作業履歴（history テーブル）の絞り込み条件を組み立てる純ロジック。
 * UI（components/history/HistoryView.tsx）はここで組み立てた条件を
 * Supabase クエリ（.eq / .ilike / .gte / .lt）に変換して使う。
 */

export type PeriodKind = "" | "today" | "week" | "custom";

/** 1回の読み込み件数（「さらに100件表示」の単位） */
export const HISTORY_PAGE_SIZE = 100;

/** "YYYY-MM-DD" をローカルタイムの 0:00 として解釈する（不正値は undefined）。
 * addDays=1 で「翌日 0:00」（終了日を含めるための排他上限）を作れる。 */
function parseLocalDate(s: string | undefined, addDays = 0): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays);
}

/** 期間種別 → created_at の範囲（ISO 文字列）。fromIso「以上」・toIso「未満」で使う。
 * - today: 当日 0:00 から（ローカルタイム基準）
 * - week: その週の月曜 0:00 から（日曜に呼んでも直前の月曜）
 * - custom: from の 0:00 〜 to の翌日 0:00（to 当日を含む）。片方だけでもよい
 */
export function periodRange(
  kind: PeriodKind,
  now: Date,
  from?: string,
  to?: string,
): { fromIso?: string; toIso?: string } {
  if (kind === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { fromIso: start.toISOString() };
  }
  if (kind === "week") {
    // getDay() は 0=日曜…6=土曜。月曜始まりにするため、月曜からの経過日数は (day + 6) % 7
    const back = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    return { fromIso: start.toISOString() };
  }
  if (kind === "custom") {
    const fromDate = parseLocalDate(from);
    const toDate = parseLocalDate(to, 1); // 終了日を含める → 翌日 0:00 未満
    return {
      ...(fromDate ? { fromIso: fromDate.toISOString() } : {}),
      ...(toDate ? { toIso: toDate.toISOString() } : {}),
    };
  }
  return {};
}

/** Supabase クエリへ渡す条件。未指定のキーは省略される（= 条件を付けない）。 */
export type HistoryFilter = {
  /** history.action への完全一致（.eq） */
  action?: string;
  /** detail->>ne_code への部分一致パターン（.ilike、% 込み） */
  codeLike?: string;
  /** created_at >= fromIso（.gte） */
  fromIso?: string;
  /** created_at < toIso（.lt） */
  toIso?: string;
};

/** 画面の入力値から Supabase クエリ条件を組み立てる。
 * action・code が空文字なら条件を付けない。code は前後の空白を除去して部分一致にする。 */
export function buildHistoryFilter(input: {
  action: string;
  code: string;
  period: PeriodKind;
  from?: string;
  to?: string;
  now?: Date;
}): HistoryFilter {
  const f: HistoryFilter = {};
  if (input.action) f.action = input.action;
  const code = input.code.trim();
  if (code) f.codeLike = `%${code}%`;
  const { fromIso, toIso } = periodRange(
    input.period,
    input.now ?? new Date(),
    input.from,
    input.to,
  );
  if (fromIso) f.fromIso = fromIso;
  if (toIso) f.toIso = toIso;
  return f;
}
