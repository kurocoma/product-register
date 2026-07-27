"use client";

import { useCallback, useState } from "react";
import type { SsCopyListItem } from "@/lib/sale-support/copies";
import type { RestoreSkuPlan, SaleSupportStatus, SaleSupportSummary } from "@/lib/sale-support/types";

/** API レスポンスの per-item（restore route の toPlanResponse / toCommitResponse と同形）。 */
type RestoreItem = {
  ssManageNumber: string;
  originalManageNumber: string;
  status: SaleSupportStatus;
  reason?: string;
  error?: string;
  title?: string;
  skus?: RestoreSkuPlan[];
  purchasablePeriod?: { start: string; end: string } | null;
  periodCleared?: boolean;
  warnings?: string[];
  verified?: boolean;
};

type RestoreResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  payloadHash?: string;
  deleteCopy?: boolean;
  results?: RestoreItem[];
  summary?: SaleSupportSummary;
};

const STATUS_LABEL: Record<SaleSupportStatus, string> = {
  plan: "復元可",
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

/** 「復元」タブ: -SS コピー一覧から選択 → プレビュー → 元商品の価格・二重価格・販売期間を書き戻す。
 * -SS コピーは実行時の選択で「削除する / 残す」を選べる（書き戻し失敗時は削除しない）。 */
export function SaleRestoreTab({ initialCopies }: { initialCopies: SsCopyListItem[] }) {
  // 初期一覧は Server Component から props で受ける（AGENTS: initial* props の踏襲）。
  const [copies, setCopies] = useState<SsCopyListItem[] | null>(initialCopies);
  const [listErr, setListErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteCopy, setDeleteCopy] = useState(false);
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<RestoreResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const loadCopies = useCallback(async () => {
    setListErr(null);
    try {
      const res = await fetch("/api/rakuten/sale-support/restore");
      const j = (await res.json()) as { ok: boolean; error?: string; copies?: SsCopyListItem[] };
      if (!res.ok || !j.ok) {
        setListErr(j.error || `一覧の取得に失敗 (HTTP ${res.status})`);
        return;
      }
      setCopies(j.copies ?? []);
    } catch (e) {
      setListErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  const toggle = (ssMn: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ssMn)) next.delete(ssMn);
      else next.add(ssMn);
      return next;
    });

  const selectionKey = [...selected].sort().join(",");
  const previewStale = data?.dryRun === true && previewKey !== selectionKey;
  const canCommit =
    data?.dryRun === true &&
    !previewStale &&
    !!data.payloadHash &&
    (data.summary?.applicable ?? 0) > 0;

  const run = async (mode: "dry" | "commit") => {
    if (selected.size === 0) {
      setErr("復元する -SS コピーを選択してください");
      return;
    }
    if (mode === "commit") {
      if (!canCommit || !data?.payloadHash) return;
      const okConfirm = window.confirm(
        `復元を実行します（対象 ${data.summary?.applicable ?? 0} 件）。\n` +
          `元商品の価格・二重価格・販売期間を -SS コピーの値に書き戻します。\n` +
          `-SS コピー: ${deleteCopy ? "削除する（書き戻し成功分のみ）" : "残す"}\nよろしいですか？`,
      );
      if (!okConfirm) return;
    }
    setBusy(mode);
    setErr(null);
    try {
      const res = await fetch("/api/rakuten/sale-support/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssManageNumbers: [...selected],
          dryRun: mode === "dry",
          payloadHash: mode === "commit" ? data?.payloadHash : undefined,
          deleteCopy: mode === "commit" ? deleteCopy : undefined,
        }),
      });
      const j = (await res.json()) as RestoreResponse;
      if (!res.ok || !j.ok) {
        setErr(j.error || `処理失敗 (HTTP ${res.status})`);
        if (res.status === 409) setData(null);
        return;
      }
      setData(j);
      if (mode === "dry") setPreviewKey(selectionKey);
      if (mode === "commit") {
        setSelected(new Set());
        void loadCopies(); // 削除した -SS を一覧へ反映
      }
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
        tone: s.failed > 0 ? "red" : "blue",
        icon: "👁",
        title: `プレビュー完了（書き込みなし）— 対象 ${s.total} 件`,
        msg: `復元可 ${s.applicable} / 失敗 ${s.failed}。下の表で書き戻す値を確認してください。`,
      };
    }
    if (s.failed === 0) {
      return {
        tone: "green",
        icon: "✅",
        title: `復元完了 — ${s.applicable} 件`,
        msg: data.deleteCopy
          ? "価格・二重価格・販売期間を書き戻し、-SS コピーを削除しました。"
          : "価格・二重価格・販売期間を書き戻しました（-SS コピーは残しています）。",
      };
    }
    return {
      tone: "red",
      icon: "❌",
      title: `一部失敗 — 成功 ${s.applicable} / 失敗 ${s.failed}`,
      msg: "失敗した商品は -SS コピーを残しています。理由を確認して再実行してください。",
    };
  })();
  const TONE: Record<string, string> = {
    green: "bg-green-50 border-green-300 text-green-800",
    blue: "bg-blue-50 border-blue-300 text-blue-800",
    red: "bg-red-50 border-red-300 text-red-800",
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <p className="text-xs text-slate-500">
        セール適用時に作成した <strong>-SS 倉庫コピー</strong>の一覧です。復元したい商品を選び、
        プレビューで書き戻す値（価格・二重価格・販売期間）を確認してから実行してください。
        -SS コピーに販売期間・二重価格が無い場合は<strong>解除</strong>（設定なしに戻す）します。
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void loadCopies()}
          disabled={busy !== null}
          className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          🔄 一覧を再読込
        </button>
        {copies && <span className="text-xs text-slate-500">{copies.length} 件の -SS コピー</span>}
      </div>

      {listErr && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ❌ {listErr}
        </div>
      )}

      {copies && copies.length === 0 && (
        <p className="text-sm text-slate-500">
          -SS コピーはありません（「セール適用」を実行するとここに表示されます）。
        </p>
      )}

      {!!copies?.length && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2 py-2">-SS 管理番号</th>
                <th className="px-2 py-2">元商品</th>
                <th className="px-2 py-2">商品名</th>
                <th className="px-2 py-2">保存日時</th>
              </tr>
            </thead>
            <tbody>
              {copies.map((c) => (
                <tr key={c.ssManageNumber} className="border-t border-slate-100">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.ssManageNumber)}
                      onChange={() => toggle(c.ssManageNumber)}
                      disabled={busy !== null}
                      aria-label={`${c.ssManageNumber} を選択`}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono">{c.ssManageNumber}</td>
                  <td className="px-2 py-2 font-mono">{c.originalManageNumber}</td>
                  <td className="px-2 py-2 text-slate-600">{c.name}</td>
                  <td className="px-2 py-2 text-slate-500">{c.updatedAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run("dry")}
          disabled={busy !== null || selected.size === 0}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "dry" ? "プレビュー中…" : `復元プレビュー（${selected.size}件・書き込みなし）`}
        </button>
        <fieldset className="flex items-center gap-3 text-sm text-slate-700" disabled={busy !== null}>
          <legend className="sr-only">-SS コピーの扱い</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="delete-copy" checked={!deleteCopy} onChange={() => setDeleteCopy(false)} />
            -SS を残す
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="delete-copy" checked={deleteCopy} onChange={() => setDeleteCopy(true)} />
            -SS を削除する
          </label>
        </fieldset>
        <button
          type="button"
          onClick={() => run("commit")}
          disabled={busy !== null || !canCommit}
          title={canCommit ? "プレビューで表示した値をそのまま書き戻します" : "先にプレビューしてください（選択を変えた場合は再プレビュー）"}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy === "commit" ? "復元中…" : "復元を実行"}
        </button>
        {previewStale && (
          <span className="text-xs text-amber-700">
            ⚠ 選択が変わりました。実行前にもう一度プレビューしてください
          </span>
        )}
      </div>

      {busy && (
        <p className="text-sm text-slate-600" role="status" aria-live="polite">
          ⏳ {busy === "dry" ? "プレビュー中…" : "復元中…"}（完了するとここに結果が表示されます）
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

      {!!data?.results?.length && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">元商品</th>
                <th className="px-2 py-2">区分</th>
                <th className="px-2 py-2">書き戻す価格（現在 → 復元値）</th>
                <th className="px-2 py-2">販売期間 / 二重価格</th>
                <th className="px-2 py-2">理由 / 警告</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.ssManageNumber} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-mono">
                    {r.originalManageNumber}
                    <div className="text-slate-400">← {r.ssManageNumber}</div>
                  </td>
                  <td className={`px-2 py-2 font-medium ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                    {r.status === "ok" && r.verified && <div className="text-[10px] text-green-700">読み戻し一致</div>}
                  </td>
                  <td className="px-2 py-2">
                    {(r.skus ?? []).map((sku) => (
                      <div key={sku.variantKey} className="whitespace-nowrap">
                        <span className="font-mono">{sku.variantKey}</span>:{" "}
                        {sku.currentNet != null ? yen(sku.currentNet) : "?"} →{" "}
                        <strong>{yen(sku.restoreNet)}</strong>円
                        {sku.referenceCleared ? (
                          <span className="text-slate-500">（二重価格: 解除）</span>
                        ) : (
                          <span className="text-indigo-700">
                            （二重価格: {String(sku.restoreReference?.value ?? "")}円）
                          </span>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.periodCleared
                      ? "販売期間: 解除（設定なしに戻す）"
                      : r.purchasablePeriod
                        ? `販売期間: ${r.purchasablePeriod.start} 〜 ${r.purchasablePeriod.end}`
                        : ""}
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
