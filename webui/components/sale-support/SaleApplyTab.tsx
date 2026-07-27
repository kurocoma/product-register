"use client";

import { useState } from "react";
import type { SaleSkuPlan, SaleSupportStatus, SaleSupportSummary } from "@/lib/sale-support/types";

/** API レスポンスの per-item（apply route の toPlanResponse / toCommitResponse と同形）。 */
type ApplyItem = {
  manageNumber: string;
  ssManageNumber: string;
  status: SaleSupportStatus;
  reason?: string;
  error?: string;
  title?: string;
  taxAssumed?: boolean;
  skus?: SaleSkuPlan[];
  warnings?: string[];
  verified?: boolean;
};

type ApplyResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  payloadHash?: string;
  discountPercent?: number;
  period?: { start: string; end: string };
  dualPrice?: boolean;
  results?: ApplyItem[];
  summary?: SaleSupportSummary;
  invalid?: { raw: string; reason: string }[];
  duplicatesRemoved?: number;
};

const STATUS_LABEL: Record<SaleSupportStatus, string> = {
  plan: "実行可",
  ok: "完了",
  excluded: "対象外",
  failed: "失敗",
};

const STATUS_CLASS: Record<SaleSupportStatus, string> = {
  plan: "text-green-700",
  ok: "text-green-700",
  excluded: "text-amber-700",
  failed: "text-red-600",
};

const yen = (n: number) => n.toLocaleString("ja-JP");

/** 楽天スーパーセール「セール適用」タブ。
 * 管理番号リスト＋値引き％＋販売期間＋二重価格ON/OFF → プレビュー →（同一値のみ）実行。
 * 実行は -SS 倉庫コピー（元価格の控え）作成 → 元商品へ価格・期間の最小patch → 読み戻し検証。 */
export function SaleApplyTab() {
  const [text, setText] = useState("");
  const [discount, setDiscount] = useState("10");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [dualPrice, setDualPrice] = useState(true);
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApplyResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const inputKey = JSON.stringify({ text, discount, start, end, dualPrice });
  const previewStale = data?.dryRun === true && previewKey !== inputKey;
  const canCommit =
    data?.dryRun === true &&
    !previewStale &&
    !!data.payloadHash &&
    (data.summary?.applicable ?? 0) > 0;

  const run = async (mode: "dry" | "commit") => {
    if (!text.trim()) {
      setErr("楽天の商品管理番号を入力してください（改行/カンマ/CSV1列）");
      return;
    }
    if (mode === "commit") {
      if (!canCommit || !data?.payloadHash) return;
      const s = data.summary;
      const okConfirm = window.confirm(
        `セールを実行します（対象 ${s?.applicable ?? 0} 件）。\n` +
          `1) -SS 倉庫コピー（元価格の控え・非公開）を作成\n` +
          `2) 値引き ${discount}%（税込×(1-％)切り捨て）を各SKUに適用\n` +
          `3) 販売期間 ${start} 〜 ${end} を設定\n` +
          `4) 二重価格: ${dualPrice ? "ON（元の価格を当店通常価格に表示）" : "OFF"}\n` +
          `※定期購入価格は変更しません。よろしいですか？`,
      );
      if (!okConfirm) return;
    }
    setBusy(mode);
    setErr(null);
    try {
      const res = await fetch("/api/rakuten/sale-support/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manageNumbers: text,
          discountPercent: Number(discount),
          periodStart: start,
          periodEnd: end,
          dualPrice,
          dryRun: mode === "dry",
          payloadHash: mode === "commit" ? data?.payloadHash : undefined,
        }),
      });
      const j = (await res.json()) as ApplyResponse;
      if (!res.ok || !j.ok) {
        setErr(j.error || `処理失敗 (HTTP ${res.status})`);
        if (res.status === 409) setData(null); // 値が変わった → 再プレビューさせる
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

  const s = data?.summary;
  const banner = (() => {
    if (!data || !s) return null;
    if (data.dryRun) {
      return {
        tone: s.failed > 0 ? "red" : s.excluded > 0 ? "amber" : "blue",
        icon: "👁",
        title: `プレビュー完了（書き込みなし）— 対象 ${s.total} 件`,
        msg:
          `実行可 ${s.applicable} / 対象外 ${s.excluded} / 失敗 ${s.failed}。` +
          "下の表で割引後価格を確認し、問題なければ「実行」してください。",
      };
    }
    if (s.failed === 0) {
      return {
        tone: "green",
        icon: "✅",
        title: `セール適用完了 — ${s.applicable} 件`,
        msg: "-SS コピー作成・値引き・販売期間の設定・読み戻し検証まで完了しました。セール終了後は「復元」タブで元に戻せます。",
      };
    }
    return {
      tone: "red",
      icon: "❌",
      title: `一部失敗 — 成功 ${s.applicable} / 失敗 ${s.failed}`,
      msg: "失敗した商品の理由を下の表で確認してください（-SS コピーが作成済みの場合は復元タブから戻せます）。",
    };
  })();
  const TONE: Record<string, string> = {
    green: "bg-green-50 border-green-300 text-green-800",
    blue: "bg-blue-50 border-blue-300 text-blue-800",
    amber: "bg-amber-50 border-amber-300 text-amber-800",
    red: "bg-red-50 border-red-300 text-red-800",
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <p className="text-xs text-slate-500">
        楽天の<strong>商品管理番号</strong>を貼り付け、値引き％と販売期間を指定してください。
        実行時は先に <strong>-SS 倉庫コピー（元価格の控え・非公開）</strong>を作成してから、
        元商品の各SKU価格を<strong>税込×(1-％) 切り捨て</strong>で値引きし、販売期間を設定します。
        既に -SS コピーがある商品は対象外（上書きしません）。定期購入価格は変更しません。
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"例:\nr117-1\nr3001-1\n（改行/カンマ/CSV1列で複数可）"}
        disabled={busy !== null}
        rows={5}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
      />

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm text-slate-700">
          <span className="block text-xs text-slate-500">値引き（%）</span>
          <input
            type="number"
            min={0.01}
            max={99.99}
            step={0.01}
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            disabled={busy !== null}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs text-slate-500">販売期間 開始（日本時間）</span>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={busy !== null}
            className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs text-slate-500">販売期間 終了（日本時間）</span>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={busy !== null}
            className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-700 pb-1">
          <input
            type="checkbox"
            checked={dualPrice}
            onChange={(e) => setDualPrice(e.target.checked)}
            disabled={busy !== null}
          />
          二重価格（元の価格を「当店通常価格」に表示）
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
          {busy === "commit" ? "実行中…" : "実行（-SSコピー作成＋値引き＋期間設定）"}
        </button>
        {previewStale && (
          <span className="text-xs text-amber-700">
            ⚠ 入力が変わりました。実行前にもう一度プレビューしてください
          </span>
        )}
      </div>

      {busy && (
        <p className="text-sm text-slate-600" role="status" aria-live="polite">
          ⏳ {busy === "dry" ? "プレビュー中…" : "実行中…"}
          （商品数により数十秒〜数分かかることがあります。完了するとここに結果が表示されます）
        </p>
      )}

      {err && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ❌ 失敗しました：{err}
        </div>
      )}

      {banner && (
        <div className={`rounded border px-3 py-2 ${TONE[banner.tone]}`} role="status" aria-live="polite">
          <div className="font-semibold">
            {banner.icon} {banner.title}
          </div>
          <div className="mt-0.5 text-xs">{banner.msg}</div>
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
                <th className="px-2 py-2">商品名</th>
                <th className="px-2 py-2">SKU別の価格（税抜/税込）</th>
                <th className="px-2 py-2">理由 / 警告</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.manageNumber} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-mono">
                    {r.manageNumber}
                    <div className="text-slate-400">→ {r.ssManageNumber}</div>
                  </td>
                  <td className={`px-2 py-2 font-medium ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                    {r.status === "ok" && r.verified && <div className="text-[10px] text-green-700">読み戻し一致</div>}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{r.title ?? ""}</td>
                  <td className="px-2 py-2">
                    {(r.skus ?? []).map((sku) => (
                      <div key={sku.variantKey} className="whitespace-nowrap">
                        <span className="font-mono">{sku.variantKey}</span>
                        {"（税"}{sku.taxPct}%{"）: "}
                        {yen(sku.beforeNet)} → <strong>{yen(sku.afterNet)}</strong>円
                        <span className="text-slate-500">
                          {"（税込 "}{yen(sku.beforeGross)} → {yen(sku.afterGross)}円{"）"}
                        </span>
                        {sku.referencePriceValue != null && (
                          <span className="text-indigo-700">
                            {" "}二重価格 {yen(sku.referencePriceValue)}円
                          </span>
                        )}
                        {sku.targetDifference > 0 && (
                          <span className="text-slate-400">（目標差 {sku.targetDifference}円）</span>
                        )}
                        {sku.hasSubscription && (
                          <span className="text-amber-700">（定期価格あり: 変更しません）</span>
                        )}
                      </div>
                    ))}
                    {r.taxAssumed && (
                      <div className="text-amber-700">※税率が取得できず 10% として計算</div>
                    )}
                  </td>
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
