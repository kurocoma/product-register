"use client";

import { useState } from "react";
import type { BulkSummary, BulkToolStatus, ReserveOutcome } from "@/lib/bulk-tools/types";
import type { JanPriceRow } from "@/lib/bulk-tools/jan-price";
import {
  BulkResultBanner,
  MallOutcomeCell,
  ReserveBanner,
  STATUS_CLASS,
  STATUS_LABEL,
  YahooReserveCheckbox,
  yen,
} from "./common";

type MallOutcome = { ok: boolean; updated: number; message: string } | null;

type ItemResponse = {
  key: string;
  productId: string;
  status: BulkToolStatus;
  reason?: string;
  error?: string;
  title?: string;
  changes?: { field: string; variantKey?: string; before: unknown; after: unknown }[];
  warnings?: string[];
  rakuten?: MallOutcome;
  yahoo?: MallOutcome;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  payloadHash?: string;
  rows?: JanPriceRow[];
  results?: ItemResponse[];
  summary?: BulkSummary;
  reserve?: ReserveOutcome;
  invalid?: { raw: string; reason: string }[];
  notFoundJans?: string[];
  duplicatesRemoved?: number;
};

const rowKeyOf = (r: { productId: string; variantKey: string }) => `${r.productId}|${r.variantKey}`;

/** 税込の参考表示（両モールとも切り捨て: 楽天 rakutenGross / Yahoo yahooTaxInclusive と同式）。
 * 確定値はプレビュー応答（サーバ計算）の new*Gross を正とする。 */
const grossOf = (net: number, taxRate: number) => net + Math.floor((net * taxRate) / 100);

/** JAN売価変更（機能1）: JAN貼付け → 一致商品/SKUを抽出 → 行ごとに新税抜価格を入力 →
 * プレビュー（payloadHash）→ 実行（DB→楽天patch→Yahoo editItem→反映予約）。 */
export function JanPricePanel() {
  const [jansText, setJansText] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [yahooReserve, setYahooReserve] = useState(true);
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const inputKey = JSON.stringify({ jansText, edits });
  const previewStale = data?.dryRun === true && previewKey !== inputKey;
  const canCommit =
    data?.dryRun === true && !previewStale && !!data.payloadHash && (data.summary?.applicable ?? 0) > 0;

  const editsPayload = () => {
    const out: { productId: string; variantKey: string; newNet: number }[] = [];
    for (const [k, v] of Object.entries(edits)) {
      const t = v.trim();
      if (!t) continue;
      const [productId, ...rest] = k.split("|");
      out.push({ productId, variantKey: rest.join("|"), newNet: Number(t) });
    }
    return out;
  };

  const run = async (mode: "dry" | "commit") => {
    if (!jansText.trim()) {
      setErr("JANコード（13桁）を入力してください（改行/カンマ/CSV1列）");
      return;
    }
    if (mode === "commit") {
      if (!canCommit || !data?.payloadHash) return;
      const s = data.summary;
      const okConfirm = window.confirm(
        `売価変更を実行します（対象 ${s?.applicable ?? 0} 商品）。\n` +
          "1) アプリDBの税抜価格を更新\n" +
          "2) 楽天へ patch（SKU価格）で反映\n" +
          "3) Yahoo へ editItem（税込変換）で反映\n" +
          `4) Yahoo 反映予約: ${yahooReserve ? "実行する" : "実行しない"}\n` +
          "よろしいですか？",
      );
      if (!okConfirm) return;
    }
    setBusy(mode);
    setErr(null);
    try {
      const res = await fetch("/api/products/bulk-tools/jan-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jans: jansText,
          edits: editsPayload(),
          dryRun: mode === "dry",
          payloadHash: mode === "commit" ? data?.payloadHash : undefined,
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
      if (mode === "dry") setPreviewKey(inputKey);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <p className="text-xs text-slate-500">
        JANコード（13桁）を貼り付けて「抽出・プレビュー」すると、そのJANを持つ商品（単品＋セット・SKU）が
        一覧表示されます。<strong>新税抜価格</strong>を入力した行だけが変更対象です（未入力の行はスキップ）。
        実行でアプリDB → 楽天（patch）→ Yahoo（editItem・税込変換）の順に反映します。
      </p>

      <textarea
        value={jansText}
        onChange={(e) => setJansText(e.target.value)}
        placeholder={"例:\n4955028002542\n4955028001234\n（改行/カンマで複数可）"}
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
          {busy === "dry" ? "プレビュー中…" : "抽出・プレビュー（書き込みなし）"}
        </button>
        <button
          type="button"
          onClick={() => run("commit")}
          disabled={busy !== null || !canCommit}
          title={canCommit ? "プレビューで表示した値をそのまま実行します" : "先にプレビューしてください（入力を変えた場合は再プレビュー）"}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy === "commit" ? "実行中…" : "実行（DB更新＋楽天・Yahoo反映）"}
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
          previewMessage="下の表で新価格（税抜/税込）を確認し、問題なければ「実行」してください。"
          doneMessage="アプリDBの価格更新とモール反映（楽天patch / Yahoo editItem）が完了しました。"
        />
      )}
      <ReserveBanner reserve={data?.reserve} />

      {!!data?.invalid?.length && (
        <div className="text-xs text-amber-700">
          不正な入力（無視）:{" "}
          <span className="font-mono">{data.invalid.map((iv) => `${iv.raw}(${iv.reason})`).join(", ")}</span>
        </div>
      )}
      {!!data?.notFoundJans?.length && (
        <div className="text-xs text-amber-700">
          一致する商品が見つからないJAN: <span className="font-mono">{data.notFoundJans.join(", ")}</span>
        </div>
      )}

      {!!data?.rows?.length && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">管理番号 / SKU</th>
                <th className="px-2 py-2">商品名</th>
                <th className="px-2 py-2">JAN</th>
                <th className="px-2 py-2">税率</th>
                <th className="px-2 py-2">現在 税抜（楽天税込 / Yahoo税込）</th>
                <th className="px-2 py-2">新税抜価格</th>
                <th className="px-2 py-2">新税込（参考）</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const rk = rowKeyOf(r);
                const input = edits[rk] ?? "";
                const n = Number(input.trim());
                const newValid = input.trim() !== "" && Number.isInteger(n) && n >= 1;
                return (
                  <tr key={rk} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1 font-mono">
                      {r.key}
                      {r.variantKey && <div className="text-slate-400">SKU: {r.variantKey}{r.variationLabel ? `（${r.variationLabel}）` : ""}</div>}
                      <div className="text-[10px] text-slate-400">{r.productType}</div>
                    </td>
                    <td className="px-2 py-1 text-slate-600">{r.title}</td>
                    <td className="px-2 py-1 font-mono">
                      {r.jan || <span className="text-slate-300">なし</span>}
                      {r.matched && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-700">一致</span>}
                    </td>
                    <td className="px-2 py-1">{r.taxRate}%</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {yen(r.currentNet)}円
                      <span className="text-slate-500">（{yen(r.currentRakutenGross)} / {yen(r.currentYahooGross)}円）</span>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        min={1}
                        value={input}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [rk]: e.target.value }))}
                        disabled={busy !== null}
                        placeholder="変更なし"
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                      />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {r.newNet != null && r.newRakutenGross != null ? (
                        <strong>
                          {yen(r.newRakutenGross)} / {yen(r.newYahooGross ?? r.newRakutenGross)}円
                        </strong>
                      ) : newValid ? (
                        <span className="text-slate-500">{yen(grossOf(n, r.taxRate))}円（要プレビュー）</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!!data?.results?.length && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">管理番号</th>
                <th className="px-2 py-2">区分</th>
                <th className="px-2 py-2">変更内容（税抜）</th>
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
                  <td className="px-2 py-2">
                    {(r.changes ?? []).map((c, i) => (
                      <div key={i} className="whitespace-nowrap">
                        {c.variantKey ? <span className="font-mono">{c.variantKey}: </span> : null}
                        {yen(Number(c.before))} → <strong>{yen(Number(c.after))}</strong>円
                      </div>
                    ))}
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
