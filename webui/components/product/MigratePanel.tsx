"use client";

import { useState } from "react";

/** API レスポンスの per-item 結果（route の MigrationItemResult と同形）。 */
type ItemResult = {
  manageNumber: string;
  productId?: string;
  step: string;
  ok: boolean;
  status: "migrate" | "requires_manual" | "skipped" | "failed" | "ok";
  error?: string;
};

type Summary = {
  total: number;
  migrated: number;
  requiresManual: number;
  skipped: number;
  failed: number;
};

type MigrateResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  publish?: boolean;
  results?: ItemResult[];
  summary?: Summary;
  invalid?: { raw: string; reason: string }[];
  duplicatesRemoved?: number;
};

const STATUS_LABEL: Record<ItemResult["status"], string> = {
  migrate: "移行可",
  ok: "登録済",
  requires_manual: "要手動",
  skipped: "スキップ",
  failed: "失敗",
};

const STATUS_CLASS: Record<ItemResult["status"], string> = {
  migrate: "text-green-700",
  ok: "text-green-700",
  requires_manual: "text-amber-700",
  skipped: "text-slate-500",
  failed: "text-red-600",
};

/** 楽天の商品管理番号リストを Yahoo!ショッピングへ一括移行するパネル。
 *
 * まず「移行プレビュー(dry-run)」で書き込みなしの per-item 判定を確認し、
 * 問題なければ「実行(登録)」で安全状態(display:0・非公開)で登録する。
 * 公開(submitItem)は行わない（安全側）。 */
export function MigratePanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<MigrateResponse | null>(null);

  const run = async (dryRun: boolean) => {
    const manageNumbers = text.trim();
    if (!manageNumbers) {
      setErr("楽天の商品管理番号を入力してください（改行/カンマ/CSV1列）");
      return;
    }
    if (!dryRun) {
      const ok = window.confirm(
        "実行(登録)します。Yahoo へ display:0(非表示)・非公開で登録します（公開はしません）。よろしいですか？",
      );
      if (!ok) return;
    }
    setBusy(dryRun ? "dry" : "commit");
    setErr(null);
    try {
      const res = await fetch("/api/migrate/rakuten-to-yahoo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manageNumbers, dryRun }),
      });
      const j = (await res.json()) as MigrateResponse;
      if (!res.ok || !j.ok) {
        setErr(j.error || `処理失敗 (HTTP ${res.status})`);
        setData(null);
        return;
      }
      setData(j);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
      setData(null);
    } finally {
      setBusy(null);
    }
  };

  const s = data?.summary;

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">🚚 楽天 → Yahoo 一括移行</div>
      <p className="text-xs text-slate-500">
        楽天の<strong>商品管理番号</strong>を改行/カンマ/CSV1列で貼り付け、まず
        <strong>移行プレビュー(dry-run)</strong>で per-item の判定を確認してください。
        実行しても Yahoo へは <strong>display:0（非表示）・非公開</strong>で登録し、公開（submitItem）は行いません。
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"例:\nmaker-1234\nmaker-5678\n（改行/カンマ/CSV1列で複数可）"}
        disabled={busy !== null}
        rows={5}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy !== null}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "dry" ? "プレビュー中…" : "移行プレビュー(dry-run)"}
        </button>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={busy !== null}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy === "commit" ? "実行中…" : "実行(登録・display:0)"}
        </button>
        {data && (
          <span className={data.dryRun ? "text-sm text-blue-700" : "text-sm text-rose-700"}>
            {data.dryRun ? "プレビュー結果（未書込）" : "実行結果（display:0 で登録）"}
          </span>
        )}
      </div>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}

      {s && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <span>対象 {s.total} 件</span>
          <span className="text-green-700">
            {data?.dryRun ? "移行可" : "成功"} {s.migrated}
          </span>
          <span className="text-amber-700">要手動 {s.requiresManual}</span>
          <span className="text-slate-500">スキップ {s.skipped}</span>
          <span className="text-red-600">失敗 {s.failed}</span>
          {!!data?.duplicatesRemoved && (
            <span className="text-slate-500">重複除去 {data.duplicatesRemoved}</span>
          )}
          {!!data?.invalid?.length && (
            <span className="text-amber-700">不正 {data.invalid.length}</span>
          )}
        </div>
      )}

      {!!data?.invalid?.length && (
        <div className="text-xs text-amber-700">
          不正な入力（無視）:{" "}
          <span className="font-mono">
            {data.invalid.map((iv) => `${iv.raw}(${iv.reason})`).join(", ")}
          </span>
        </div>
      )}

      {!!data?.results?.length && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">管理番号</th>
                <th className="px-2 py-2">区分</th>
                <th className="px-2 py-2">段階</th>
                <th className="px-2 py-2">既存ID</th>
                <th className="px-2 py-2">理由 / エラー</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.manageNumber} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-mono">{r.manageNumber}</td>
                  <td className={`px-2 py-2 font-medium ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </td>
                  <td className="px-2 py-2">{r.step}</td>
                  <td className="px-2 py-2 font-mono">{r.productId ?? ""}</td>
                  <td className="px-2 py-2 text-slate-600">{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
