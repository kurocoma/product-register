"use client";

import type { BulkSummary, BulkToolStatus, ReserveOutcome } from "@/lib/bulk-tools/types";

/** 一括ツール3画面（JAN売価変更・お知らせ一括追記・商品名セール文言）共通のUI小物。 */

export const STATUS_LABEL: Record<BulkToolStatus, string> = {
  plan: "実行可",
  ok: "完了",
  excluded: "対象外",
  failed: "失敗",
};

export const STATUS_CLASS: Record<BulkToolStatus, string> = {
  plan: "text-green-700",
  ok: "text-green-700",
  excluded: "text-amber-700",
  failed: "text-red-600",
};

export const yen = (n: number) => n.toLocaleString("ja-JP");

const TONE: Record<string, string> = {
  green: "bg-green-50 border-green-300 text-green-800",
  blue: "bg-blue-50 border-blue-300 text-blue-800",
  amber: "bg-amber-50 border-amber-300 text-amber-800",
  red: "bg-red-50 border-red-300 text-red-800",
};

/** プレビュー/実行結果のサマリバナー（sale-support と同じ見せ方）。 */
export function BulkResultBanner({
  dryRun,
  summary,
  doneMessage,
  previewMessage,
}: {
  dryRun: boolean;
  summary: BulkSummary;
  doneMessage: string;
  previewMessage: string;
}) {
  const s = summary;
  let tone: string;
  let icon: string;
  let title: string;
  let msg: string;
  if (dryRun) {
    tone = s.failed > 0 ? "red" : s.excluded > 0 ? "amber" : "blue";
    icon = "👁";
    title = `プレビュー完了（書き込みなし）— 対象 ${s.total} 件`;
    msg = `実行可 ${s.applicable} / 対象外 ${s.excluded} / 失敗 ${s.failed}。${previewMessage}`;
  } else if (s.failed === 0) {
    tone = "green";
    icon = "✅";
    title = `完了 — ${s.applicable} 件`;
    msg = doneMessage;
  } else {
    tone = "red";
    icon = "❌";
    title = `一部失敗 — 成功 ${s.applicable} / 失敗 ${s.failed}`;
    msg = "失敗した商品の理由を下の表で確認してください（アプリDBが更新済みの場合は商品編集画面の「反映」で再送できます）。";
  }
  return (
    <div className={`rounded border px-3 py-2 ${TONE[tone]}`} role="status" aria-live="polite">
      <div className="font-semibold">
        {icon} {title}
      </div>
      <div className="mt-0.5 text-xs">{msg}</div>
    </div>
  );
}

/** Yahoo 反映予約（reservePublish）の実行結果表示。 */
export function ReserveBanner({ reserve }: { reserve?: ReserveOutcome | null }) {
  if (!reserve || !reserve.requested) return null;
  const cls = reserve.ok ? "text-green-700" : "text-red-600";
  return (
    <p className={`text-xs ${cls}`}>
      Yahoo反映予約: {reserve.executed ? (reserve.ok ? "予約しました" : "失敗") : "未実行"} — {reserve.message}
    </p>
  );
}

/** モール別の実行結果セル（楽天/Yahoo）。 */
export function MallOutcomeCell({
  outcome,
}: {
  outcome?: { ok: boolean; updated: number; message: string } | null;
}) {
  if (!outcome) return <span className="text-slate-400">—</span>;
  return (
    <span className={outcome.ok ? "text-green-700" : "text-red-600"}>
      {outcome.ok ? (outcome.updated > 0 ? "反映" : "変更なし") : "失敗"}
      <span className="block text-[10px] text-slate-500 whitespace-pre-wrap">{outcome.message}</span>
    </span>
  );
}

/** Yahoo 反映予約チェックボックス（実行時オプション。既定ON）。 */
export function YahooReserveCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-1 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      実行後に Yahoo 反映予約（reservePublish）を行う
      <span className="text-xs text-slate-400">（Yahoo はストア全体の反映予約をしないと公開ページに出ません）</span>
    </label>
  );
}
