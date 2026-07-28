"use client";

import { useState } from "react";
import type { BulkSummary, BulkToolStatus, ReserveOutcome } from "@/lib/bulk-tools/types";
import type { SaleNameCheck } from "@/lib/bulk-tools/sale-name";
import {
  BulkResultBanner,
  MallOutcomeCell,
  ReserveBanner,
  STATUS_CLASS,
  STATUS_LABEL,
  YahooReserveCheckbox,
} from "./common";

type MallOutcome = { ok: boolean; updated: number; message: string } | null;

type ItemResponse = {
  key: string;
  productId: string;
  status: BulkToolStatus;
  reason?: string;
  error?: string;
  before?: string;
  after?: string;
  violation?: SaleNameCheck;
  warnings?: string[];
  rakuten?: MallOutcome;
  yahoo?: MallOutcome;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  payloadHash?: string;
  mode?: "add" | "remove";
  phrase?: string;
  results?: ItemResponse[];
  summary?: BulkSummary;
  reserve?: ReserveOutcome;
  invalid?: { raw: string; reason: string }[];
  duplicatesRemoved?: number;
};

/** 商品名セール文言（機能3）: 文言＋管理番号リスト → 先頭追記/解除のプレビュー →
 * 文字数レギュレーション（楽天255バイト・Yahoo全角75字）違反は除外して実行。 */
export function SaleNamePanel() {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [phrase, setPhrase] = useState("");
  const [manageText, setManageText] = useState("");
  const [yahooReserve, setYahooReserve] = useState(true);
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const inputKey = JSON.stringify({ mode, phrase, manageText });
  const previewStale = data?.dryRun === true && previewKey !== inputKey;
  const canCommit =
    data?.dryRun === true && !previewStale && !!data.payloadHash && (data.summary?.applicable ?? 0) > 0;

  const run = async (m: "dry" | "commit") => {
    if (!phrase.trim()) {
      setErr("セール文言を入力してください");
      return;
    }
    if (!manageText.trim()) {
      setErr("管理番号を入力してください（改行/カンマ/CSV1列）");
      return;
    }
    if (m === "commit") {
      if (!canCommit || !data?.payloadHash) return;
      const s = data.summary;
      const okConfirm = window.confirm(
        mode === "add"
          ? `商品名の先頭に「${phrase.trim()} 」を追記します（対象 ${s?.applicable ?? 0} 商品）。\n` +
              "アプリDB更新 → 楽天patch → Yahoo editItem の順に反映します。よろしいですか？"
          : `商品名の先頭から「${phrase.trim()} 」を除去します（対象 ${s?.applicable ?? 0} 商品）。\n` +
              "アプリDB更新 → 楽天patch → Yahoo editItem の順に反映します。よろしいですか？",
      );
      if (!okConfirm) return;
    }
    setBusy(m);
    setErr(null);
    try {
      const res = await fetch("/api/products/bulk-tools/sale-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          phrase,
          manageNumbers: manageText,
          dryRun: m === "dry",
          payloadHash: m === "commit" ? data?.payloadHash : undefined,
          yahooReserve,
        }),
      });
      const j = (await res.json()) as ApiResponse;
      if (!res.ok || !j.ok) {
        setErr(j.error || `処理失敗 (HTTP ${res.status})`);
        if (res.status === 409) setData(null);
        return;
      }
      setData(j);
      if (m === "dry") setPreviewKey(inputKey);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <p className="text-xs text-slate-500">
        セール文言を<strong>商品名の先頭</strong>へ追記します（文言と元の商品名の間は半角スペース1個）。
        文字数レギュレーション（楽天=255バイト〈全角127字相当〉・Yahoo=全角75字）に違反する商品は
        実行から除外し、警告一覧に超過量を表示します。解除は同じ文言を入力して「解除」モードで実行してください
        （先頭からの完全一致で除去。先頭に無い商品はスキップ）。
      </p>

      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "add"} onChange={() => setMode("add")} disabled={busy !== null} />
          追記
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === "remove"} onChange={() => setMode("remove")} disabled={busy !== null} />
          解除（先頭から除去）
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs text-slate-500">セール文言</span>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="例: 【スーパーセール10%OFF】"
            disabled={busy !== null}
            className="w-80 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
      </div>

      <textarea
        value={manageText}
        onChange={(e) => setManageText(e.target.value)}
        placeholder={"対象の管理番号:\nr117-1\nr3001-1\n（改行/カンマ/CSV1列で複数可）"}
        disabled={busy !== null}
        rows={4}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run("dry")}
          disabled={busy !== null}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "dry" ? "プレビュー中…" : "プレビュー（書き込みなし）"}
        </button>
        <button
          type="button"
          onClick={() => run("commit")}
          disabled={busy !== null || !canCommit}
          title={canCommit ? "プレビューで表示した値をそのまま実行します" : "先にプレビューしてください（入力を変えた場合は再プレビュー）"}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy === "commit" ? "実行中…" : mode === "add" ? "実行（追記＋モール反映）" : "実行（解除＋モール反映）"}
        </button>
        {previewStale && (
          <span className="text-xs text-amber-700">⚠ 入力が変わりました。実行前にもう一度プレビューしてください</span>
        )}
      </div>
      <YahooReserveCheckbox checked={yahooReserve} onChange={setYahooReserve} disabled={busy !== null} />

      {busy && (
        <p className="text-sm text-slate-600" role="status" aria-live="polite">
          ⏳ {busy === "dry" ? "プレビュー中…" : "実行中…"}（商品数により数十秒〜数分かかることがあります）
        </p>
      )}

      {err && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ❌ 失敗しました：{err}
        </div>
      )}

      {data?.summary && (
        <BulkResultBanner
          dryRun={data.dryRun === true}
          summary={data.summary}
          previewMessage="下の表で変更後の商品名と文字数を確認し、問題なければ「実行」してください。"
          doneMessage="商品名の変更とモール反映が完了しました。"
        />
      )}
      <ReserveBanner reserve={data?.reserve} />

      {!!data?.invalid?.length && (
        <div className="text-xs text-amber-700">
          不正な入力（無視）:{" "}
          <span className="font-mono">{data.invalid.map((iv) => `${iv.raw}(${iv.reason})`).join(", ")}</span>
        </div>
      )}

      {!!data?.results?.length && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">管理番号</th>
                <th className="px-2 py-2">区分</th>
                <th className="px-2 py-2">商品名（変更前 → 変更後）</th>
                <th className="px-2 py-2">文字数</th>
                <th className="px-2 py-2">楽天</th>
                <th className="px-2 py-2">Yahoo</th>
                <th className="px-2 py-2">理由 / 警告</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.productId || r.key} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-mono">{r.key}</td>
                  <td className={`px-2 py-2 font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</td>
                  <td className="px-2 py-2 text-slate-600">
                    <div className="break-all">{r.before ?? ""}</div>
                    {r.after && (
                      <div className="break-all">
                        → <strong>{r.after}</strong>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {r.violation ? (
                      <div className="text-red-600">
                        楽天 {r.violation.rakutenBytes}/255バイト
                        {r.violation.rakutenOverBytes > 0 && <strong>（{r.violation.rakutenOverBytes}超過）</strong>}
                        <br />
                        Yahoo 全角{r.violation.yahooFullWidth}/{r.violation.yahooLimit}字
                        {r.violation.yahooOverFullWidth > 0 && <strong>（{r.violation.yahooOverFullWidth}超過）</strong>}
                        {r.violation.yahooOverChars > 0 && <strong>（文字数{r.violation.yahooOverChars}超過）</strong>}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2"><MallOutcomeCell outcome={r.rakuten} /></td>
                  <td className="px-2 py-2"><MallOutcomeCell outcome={r.yahoo} /></td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.reason ?? r.error ?? ""}
                    {(r.warnings ?? []).map((w, i) => (
                      <div key={i} className="text-amber-700">⚠ {w}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
