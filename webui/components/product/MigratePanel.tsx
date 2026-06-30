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
  stockQuantity?: number;
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
  const [qty, setQty] = useState(100);
  const [busy, setBusy] = useState<null | "dry" | "commit" | "publish">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<MigrateResponse | null>(null);

  /** mode: "dry"=プレビュー / "commit"=非公開登録(display:0) / "publish"=公開登録(display:1・在庫・反映) */
  const run = async (mode: "dry" | "commit" | "publish") => {
    const manageNumbers = text.trim();
    if (!manageNumbers) {
      setErr("楽天の商品管理番号を入力してください（改行/カンマ/CSV1列）");
      return;
    }
    const dryRun = mode === "dry";
    const publish = mode === "publish";
    if (mode === "commit") {
      const ok = window.confirm(
        "実行(登録)します。Yahoo へ display:0(非表示)・非公開で登録します（公開はしません）。よろしいですか？",
      );
      if (!ok) return;
    }
    if (publish) {
      if (!(qty >= 0)) {
        setErr("在庫数は0以上の整数で入力してください");
        return;
      }
      const ok = window.confirm(
        `【公開で登録】します。対象を Yahoo に display:1(表示)・在庫${qty}・公開反映(submitItem)で登録します。\n` +
          "→ 一般に表示され購入可能になります。よろしいですか？",
      );
      if (!ok) return;
    }
    setBusy(mode);
    setErr(null);
    try {
      const res = await fetch("/api/migrate/rakuten-to-yahoo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manageNumbers, dryRun, publish, stockQuantity: publish ? qty : undefined }),
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

  const TONE: Record<string, string> = {
    green: "bg-green-50 border-green-300 text-green-800",
    blue: "bg-blue-50 border-blue-300 text-blue-800",
    amber: "bg-amber-50 border-amber-300 text-amber-800",
    red: "bg-red-50 border-red-300 text-red-800",
  };
  // 実行/プレビュー後に「成功か失敗か」を一目で示すバナー。
  const banner = (() => {
    if (!data || !s) return null;
    if (data.dryRun) {
      const clean = s.failed === 0 && s.requiresManual === 0;
      return {
        tone: s.failed > 0 ? "red" : s.requiresManual > 0 ? "amber" : "blue",
        icon: "👁",
        title: `プレビュー完了（書き込みなし）— 対象 ${s.total} 件`,
        msg:
          `移行可 ${s.migrated} / 要手動 ${s.requiresManual} / スキップ ${s.skipped} / 失敗 ${s.failed}` +
          (clean ? "。問題なければ「実行」で登録できます。" : "。下の表で要対応の理由を確認してください。"),
      };
    }
    if (s.failed === 0 && s.requiresManual === 0) {
      if (data.publish) {
        return {
          tone: "green",
          icon: "✅",
          title: `公開登録完了 — ${s.migrated} 件を公開しました（display:1・在庫${data.stockQuantity ?? qty}・反映）`,
          msg: "Yahoo に表示・販売開始の状態で登録・反映しました。反映の最終状態はストアクリエイターMgrでご確認ください。",
        };
      }
      return {
        tone: "green",
        icon: "✅",
        title: `実行完了 — ${s.migrated} 件を Yahoo に登録しました（display:0・非公開）`,
        msg: "公開はしていません。販売開始は「公開で登録」または ストアクリエイターMgr で「表示」に変更してください。",
      };
    }
    return {
      tone: s.failed > 0 ? "red" : "amber",
      icon: s.failed > 0 ? "❌" : "⚠",
      title:
        s.failed > 0
          ? `一部失敗 — 成功 ${s.migrated} / 失敗 ${s.failed}`
          : `完了（要対応あり）— 成功 ${s.migrated} / 要手動 ${s.requiresManual}`,
      msg: "下の表で各商品の段階・理由を確認してください。",
    };
  })();

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">🚚 楽天 → Yahoo 一括移行</div>
      <p className="text-xs text-slate-500">
        楽天の<strong>商品管理番号</strong>を改行/カンマ/CSV1列で貼り付け、まず
        <strong>移行プレビュー(dry-run)</strong>で per-item の判定を確認してください。
        <strong>実行(登録)</strong>は <strong>display:0（非表示）・非公開</strong>で安全に登録します。
        <strong className="text-emerald-700">公開で登録</strong>は <strong>display:1（表示）・在庫設定・公開反映(submitItem)</strong>まで行い、
        <strong className="text-emerald-700">実際に販売開始</strong>します（一般に表示・購入可能）。
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
          onClick={() => run("dry")}
          disabled={busy !== null}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "dry" ? "プレビュー中…" : "移行プレビュー(dry-run)"}
        </button>
        <button
          type="button"
          onClick={() => run("commit")}
          disabled={busy !== null}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy === "commit" ? "実行中…" : "実行(登録・display:0 非公開)"}
        </button>

        <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />

        <label className="flex items-center gap-1 text-sm text-slate-700">
          在庫
          <input
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            disabled={busy !== null}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => run("publish")}
          disabled={busy !== null}
          title="display:1(表示)・在庫設定・公開反映(submitItem)まで行い、実際に販売開始します"
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "publish" ? "公開登録中…" : "🚀 公開で登録(display:1・在庫・反映)"}
        </button>
      </div>

      {busy && (
        <p className="text-sm text-slate-600" role="status" aria-live="polite">
          ⏳ {busy === "dry" ? "プレビュー中…" : busy === "publish" ? "公開登録中…" : "登録処理中…"}（商品数により数十秒かかることがあります。完了するとここに結果が表示されます）
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
