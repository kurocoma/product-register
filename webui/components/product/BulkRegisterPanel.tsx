"use client";

import { useState } from "react";
import Link from "next/link";
import type { BulkItemResult, BulkResponse, Mall } from "@/lib/register/types";
import { selectCommitTargets } from "@/lib/register/bulk-plan";

const MALL_LABEL: Record<Mall, string> = { rakuten: "楽天", yahoo: "Yahoo" };

type Progress = { done: number; total: number; ok: number; ng: number };

/** 商品一覧の一括モール登録パネル（複数選択時のみ表示）。
 * 「一括反映」（掲載済み商品への変更反映）とは別機能: こちらは未掲載/既存の商品を
 * モールに新規作成・上書き更新する。「確認(dry-run) → 登録」の2段階で、
 * モールAPIへは1件ずつ順番に送信し進捗を表示する。 */
export function BulkRegisterPanel({
  selectedIds,
  onRegistered,
}: {
  selectedIds: string[];
  /** 登録成功した商品ID（一覧の mall_listed 表示を更新するための通知）。 */
  onRegistered?: (ids: string[], mall: Mall) => void;
}) {
  const [mall, setMall] = useState<Mall>("rakuten");
  const [busy, setBusy] = useState<"check" | "register" | null>(null);
  const [checked, setChecked] = useState<BulkResponse | null>(null);
  const [checkedIdsKey, setCheckedIdsKey] = useState<string>("");
  const [commitResults, setCommitResults] = useState<BulkItemResult[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [publish, setPublish] = useState(false);
  const [submitYahoo, setSubmitYahoo] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const idsKey = selectedIds.join(",");
  const stale = checked !== null && checkedIdsKey !== idsKey; // 確認後に選択が変わった

  const resetResults = () => {
    setChecked(null);
    setCommitResults([]);
    setProgress(null);
    setError(null);
    setSubmitNote(null);
  };

  const switchMall = (m: Mall) => {
    setMall(m);
    resetResults();
  };

  const runCheck = async () => {
    setBusy("check");
    resetResults();
    try {
      const res = await fetch(`/api/register/bulk/${mall}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, dryRun: true }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error || `確認失敗 (HTTP ${res.status})`);
        return;
      }
      setChecked(j as BulkResponse);
      setCheckedIdsKey(idsKey);
    } catch (e) {
      setError("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const { targets, skippedOverwrite } = checked
    ? selectCommitTargets(checked.results, overwrite)
    : { targets: [] as BulkItemResult[], skippedOverwrite: [] as BulkItemResult[] };

  const runRegister = async () => {
    if (!checked || stale || targets.length === 0) return;
    const overwriteCount = targets.filter((r) => r.willOverwrite).length;
    if (overwriteCount > 0) {
      if (
        !confirm(
          `${overwriteCount}件は${MALL_LABEL[mall]}の既存商品を上書き更新します。実行しますか？\n（残り${targets.length - overwriteCount}件は新規登録）`,
        )
      )
        return;
    }
    setBusy("register");
    setError(null);
    setCommitResults([]);
    setSubmitNote(null);
    setProgress({ done: 0, total: targets.length, ok: 0, ng: 0 });

    const done: BulkItemResult[] = [];
    const okIds: string[] = [];
    // モールAPIに負荷をかけないため1件ずつ順番に送信する（並列にしない）
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const isLast = i === targets.length - 1;
      try {
        const res = await fetch(`/api/register/bulk/${mall}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [t.id],
            dryRun: false,
            publish,
            overwrite,
            // Yahooの「反映」はストア全体単位のため、最後の1件の処理後に1回だけ予約する
            submit: mall === "yahoo" && submitYahoo && isLast,
          }),
        });
        const j = (await res.json()) as BulkResponse & { error?: string };
        const r: BulkItemResult = j?.results?.[0] ?? {
          id: t.id,
          ne_code: t.ne_code,
          product_name: t.product_name,
          ok: false,
          error: j?.error || `HTTP ${res.status}`,
        };
        done.push(r);
        if (r.ok) okIds.push(t.id);
        if (typeof j?.submitted === "boolean") {
          setSubmitNote(
            j.submitted
              ? "✓ Yahooに反映を予約しました（公開処理はYahoo側で順次実行されます）"
              : `Yahooへの反映は保留: ${j.submitMessage ?? ""}`,
          );
        }
      } catch (e) {
        done.push({
          id: t.id,
          ne_code: t.ne_code,
          product_name: t.product_name,
          ok: false,
          error: "通信エラー: " + (e instanceof Error ? e.message : String(e)),
        });
      }
      setCommitResults([...done]);
      setProgress({
        done: i + 1,
        total: targets.length,
        ok: done.filter((r) => r.ok).length,
        ng: done.filter((r) => !r.ok).length,
      });
    }
    if (okIds.length > 0) onRegistered?.(okIds, mall);
    setBusy(null);
  };

  const judgeLabel = (r: BulkItemResult, committed: boolean) => {
    if (committed) {
      if (r.ok) return <span className="text-green-700">✓ {r.action === "update" ? "上書き更新しました" : "新規登録しました"}</span>;
      return <span className="text-red-600">✗ {r.error || "失敗"}</span>;
    }
    if (r.ok) {
      return r.willOverwrite ? (
        <span className="text-amber-700">⚠ 登録可能（既存あり・上書き更新になります）</span>
      ) : (
        <span className="text-green-700">○ 登録可能（新規作成）</span>
      );
    }
    if (r.missing && r.missing.length > 0) {
      return <span className="text-red-600">必須項目不足: {r.missing.join(", ")}</span>;
    }
    return <span className="text-red-600">✗ {r.error || "判定できません"}</span>;
  };

  const resultTable = (rows: BulkItemResult[], committed: boolean) => (
    <div className="max-h-64 overflow-y-auto rounded border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-left sticky top-0">
          <tr>
            <th className="px-2 py-1">NEコード</th>
            <th className="px-2 py-1">商品名</th>
            <th className="px-2 py-1">結果</th>
            <th className="px-2 py-1 w-12">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-slate-100 ${r.ok ? "" : "bg-red-50"}`}>
              <td className="px-2 py-1 font-mono">{r.ne_code || "(未設定)"}</td>
              <td className="px-2 py-1">{r.product_name || "(名称未設定)"}</td>
              <td className="px-2 py-1">{judgeLabel(r, committed)}</td>
              <td className="px-2 py-1">
                <Link href={`/products/${r.id}`} className="text-blue-600 hover:underline">
                  編集
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="rounded border border-indigo-200 bg-indigo-50/50 p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">📦 一括モール登録（選択 {selectedIds.length} 件）</span>
        <span className="text-xs text-slate-500">
          未掲載の商品をモールに新規作成、または既存商品を上書き更新します（掲載済みへの変更反映は上の「一括反映」）
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["rakuten", "yahoo"] as Mall[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMall(m)}
              disabled={busy !== null}
              className={`rounded border px-2 py-1 text-xs font-medium ${
                mall === m
                  ? "border-indigo-500 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {MALL_LABEL[m]}
            </button>
          ))}
        </div>

        {mall === "rakuten" && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} disabled={busy !== null} />
            公開状態で登録する（チェックなし = 倉庫・在庫0の安全登録）
          </label>
        )}
        {mall === "yahoo" && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={submitYahoo} onChange={(e) => setSubmitYahoo(e.target.checked)} disabled={busy !== null} />
            登録後にストアへ反映を予約する（チェックなし = 登録のみ・非公開）
          </label>
        )}
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={busy !== null} />
          既存商品を上書きする（チェックなし = 既存ありの商品はスキップ）
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runCheck}
          disabled={busy !== null || selectedIds.length === 0}
          className="rounded border border-indigo-400 bg-white px-3 py-1.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy === "check" ? "確認中…" : "① 登録内容を確認（送信しません）"}
        </button>
        <button
          onClick={runRegister}
          disabled={busy !== null || !checked || stale || targets.length === 0}
          className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === "register" ? "登録中…" : `② ${MALL_LABEL[mall]}へ一括登録（${targets.length}件）`}
        </button>
        {progress && (
          <span className={busy === "register" ? "text-blue-700" : "text-slate-600"}>
            {busy === "register"
              ? `${progress.done}/${progress.total} 件処理中… 成功 ${progress.ok} / 失敗 ${progress.ng}`
              : `完了: ${progress.total} 件中 成功 ${progress.ok} / 失敗 ${progress.ng}`}
          </span>
        )}
      </div>

      {stale && (
        <p className="text-xs text-amber-700">⚠ 選択商品が変わりました。もう一度「登録内容を確認」を押してください</p>
      )}
      {error && <p className="text-red-600">⚠ {error}</p>}

      {checked && !stale && commitResults.length === 0 && (
        <div className="space-y-1">
          <div className="text-xs text-slate-600">
            確認結果: 全 {checked.total} 件 / 登録可能 {checked.valid} 件 / 必須不足 {checked.invalid} 件 / 上書きになる {checked.willOverwrite} 件
          </div>
          {skippedOverwrite.length > 0 && (
            <div className="text-xs text-amber-700">
              ⚠ 既存商品あり {skippedOverwrite.length} 件は対象外です（含めるには「既存商品を上書きする」をオン）
            </div>
          )}
          {resultTable(checked.results, false)}
        </div>
      )}

      {commitResults.length > 0 && (
        <div className="space-y-1">
          {submitNote && <div className="text-xs text-slate-700">{submitNote}</div>}
          {resultTable(commitResults, true)}
          {commitResults.some((r) => !r.ok) && (
            <p className="text-xs text-red-600">
              失敗した商品は「編集」リンクから内容を修正して、もう一度確認→登録してください
            </p>
          )}
        </div>
      )}
    </div>
  );
}
