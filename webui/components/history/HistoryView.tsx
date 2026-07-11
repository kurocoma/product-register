"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { HelpLink } from "@/components/help/HelpLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildHistoryFilter,
  HISTORY_PAGE_SIZE,
  type PeriodKind,
} from "@/lib/history/filter";

export type HistoryRow = {
  id: string;
  action: string;
  product_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  create: "新規作成",
  edit: "編集",
  delete: "削除",
  csv_export: "CSV 出力",
};

const SELECT_COLUMNS = "id, action, product_id, detail, created_at";

const selectClass =
  "rounded border border-slate-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

export function HistoryView({ initial }: { initial: HistoryRow[] }) {
  const [rows, setRows] = useState<HistoryRow[]>(initial);
  const [action, setAction] = useState("");
  const [code, setCode] = useState("");
  const [period, setPeriod] = useState<PeriodKind>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(initial.length < HISTORY_PAGE_SIZE);
  const requestId = useRef(0);
  const firstRun = useRef(true);

  /** 現在の絞り込み条件で offset から 100 件取得。append=true なら末尾に追記（さらに表示）。
   * 絞り込みは Supabase クエリ側で行う（直近 100 件より前の記録も検索対象にするため）。 */
  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError("");
      const supabase = createClient();
      const f = buildHistoryFilter({
        action,
        code,
        period,
        from: from || undefined,
        to: to || undefined,
      });
      let q = supabase
        .from("history")
        .select(SELECT_COLUMNS)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }) // created_at 同時刻でもページ送りが安定するように
        .range(offset, offset + HISTORY_PAGE_SIZE - 1);
      if (f.action) q = q.eq("action", f.action);
      if (f.codeLike) q = q.ilike("detail->>ne_code", f.codeLike);
      if (f.fromIso) q = q.gte("created_at", f.fromIso);
      if (f.toIso) q = q.lt("created_at", f.toIso);
      const { data, error: err } = await q;
      if (id !== requestId.current) return; // 古いリクエストの結果は捨てる
      setLoading(false);
      if (err) {
        setError("履歴の取得に失敗しました。時間をおいてもう一度お試しください。");
        return;
      }
      const list = (data ?? []) as unknown as HistoryRow[];
      setRows((prev) => (append ? [...prev, ...list] : list));
      setDone(list.length < HISTORY_PAGE_SIZE);
    },
    [action, code, period, from, to],
  );

  // 絞り込み条件を変えたら 1 ページ目から取り直す（入力中の連打を避けるため 300ms デバウンス）。
  // 初回はサーバーから受け取った直近 100 件をそのまま表示する。
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => fetchPage(0, false), 300);
    return () => clearTimeout(t);
  }, [fetchPage]);

  const filtered = !!(action || code.trim() || period);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">作業履歴</h1>
        <HelpLink anchor="screen-history" />
      </div>
      <p className="text-sm text-slate-500">
        操作の種類・商品コード・期間で絞り込めます。商品コードを押すとその商品の編集画面が開きます。
      </p>

      <div className="bg-white rounded border border-slate-200 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="history-action" className="block text-xs text-slate-500 mb-1">
            操作の種類
          </label>
          <select
            id="history-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className={selectClass}
          >
            <option value="">全て</option>
            <option value="create">新規作成</option>
            <option value="edit">編集</option>
            <option value="delete">削除</option>
            <option value="csv_export">CSV 出力</option>
          </select>
        </div>
        <div>
          <label htmlFor="history-code" className="block text-xs text-slate-500 mb-1">
            商品コード
          </label>
          <Input
            id="history-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="NEコードの一部でOK"
            className="w-48"
          />
        </div>
        <div>
          <label htmlFor="history-period" className="block text-xs text-slate-500 mb-1">
            期間
          </label>
          <select
            id="history-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKind)}
            className={selectClass}
          >
            <option value="">全期間</option>
            <option value="today">今日</option>
            <option value="week">今週</option>
            <option value="custom">日付指定</option>
          </select>
        </div>
        {period === "custom" && (
          <>
            <div>
              <label htmlFor="history-from" className="block text-xs text-slate-500 mb-1">
                開始日
              </label>
              <input
                id="history-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={selectClass}
              />
            </div>
            <div>
              <label htmlFor="history-to" className="block text-xs text-slate-500 mb-1">
                終了日（この日を含む）
              </label>
              <input
                id="history-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={selectClass}
              />
            </div>
          </>
        )}
        {loading && <span className="pb-2 text-xs text-slate-400">読み込み中…</span>}
      </div>

      {error && <p className="text-sm text-red-600">⚠ {error}</p>}

      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2">操作</th>
              <th className="px-3 py-2">商品コード</th>
              <th className="px-3 py-2">詳細</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  {filtered ? "条件に合う履歴がありません" : "履歴がありません"}
                </td>
              </tr>
            ) : (
              rows.map((h) => {
                const detail = (h.detail as Record<string, unknown>) ?? {};
                const neCode = detail.ne_code != null ? String(detail.ne_code) : "";
                return (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs">
                      {new Date(h.created_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {ACTION_LABEL[h.action] ?? h.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {h.product_id ? (
                        <Link
                          href={`/products/${h.product_id}`}
                          className="text-blue-600 hover:underline"
                          title="この商品の編集画面を開く"
                        >
                          {neCode || "（商品を開く）"}
                        </Link>
                      ) : (
                        neCode || "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {h.action === "csv_export"
                        ? `${(detail.malls as string[] | undefined)?.join("/") ?? ""} (${detail.productCount ?? 0}商品)`
                        : ""}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        {done ? (
          rows.length > 0 && (
            <span className="text-xs text-slate-400">これ以上ありません</span>
          )
        ) : (
          <Button
            variant="outline"
            onClick={() => fetchPage(rows.length, true)}
            disabled={loading}
          >
            {loading ? "読み込み中…" : "さらに100件表示"}
          </Button>
        )}
        <span className="text-xs text-slate-400">{rows.length} 件表示中</span>
      </div>
    </div>
  );
}
