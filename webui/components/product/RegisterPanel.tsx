"use client";

import { useState } from "react";

type Mall = "rakuten" | "yahoo";
type Preview = {
  valid: boolean; missing: string[]; willOverwrite: boolean; key: string; body?: unknown; params?: unknown;
  /** Yahoo: 統合商品（多SKU）は SKU ごとに分けて登録するため、その件数（単一商品は 1）。 */
  skuCount?: number;
};

/** 商品をモールAPIで直接登録するパネル。CSVダウンロードと並走（置換しない）。
 * 「登録内容を確認(dry-run)」→「登録する」の2段。上書き時は確認。Yahooは反映(submit)を別ボタン。 */
export function RegisterPanel({ productId }: { productId?: string }) {
  const [mall, setMall] = useState<Mall>("rakuten");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!productId) {
    return (
      <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-600 space-y-1">
        <div className="font-semibold text-slate-700">🚀 モールAPI登録（保存後に使えます）</div>
        <p>
          まず <span className="font-medium">NEコード・商品名・JANコード・販売価格</span>{" "}
          を入力して商品を保存してください。
        </p>
        <p>保存が完了すると、ここに楽天/Yahooへの登録ボタンが表示されます。</p>
      </div>
    );
  }

  const reset = () => { setMsg(null); setErr(null); };

  const runDryRun = async () => {
    setBusy(true); reset(); setPreview(null);
    try {
      const res = await fetch(`/api/register/${mall}/${productId}?dryRun=1`);
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `確認失敗 (HTTP ${res.status})`); return; }
      setPreview({
        valid: j.valid, missing: j.missing || [], willOverwrite: j.willOverwrite,
        key: mall === "rakuten" ? j.manageNumber : j.itemCode,
        body: j.body, params: j.params,
        skuCount: typeof j.skuCount === "number" ? j.skuCount : 1,
      });
    } catch (e) { setErr("通信エラー: " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };

  const register = async () => {
    if (!preview) return;
    if (preview.willOverwrite && !confirm(`「${preview.key}」は既にモールに存在します。上書き登録しますか？`)) return;
    setBusy(true); reset();
    try {
      const body = mall === "rakuten" ? {} : { submit: false };
      const res = await fetch(`/api/register/${mall}/${productId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `登録失敗 (HTTP ${res.status})`); return; }
      setMsg(mall === "rakuten"
        ? `✓ 楽天に${j.created ? "新規登録" : "更新"}しました (${j.manageNumber})`
        // 統合商品（多SKU）は SKU 別の成否を集約表示（例「4SKU中4件登録」）
        : `✓ Yahooに${j.wasUpdate ? "更新" : "登録"}しました (${j.skuSummary ? `${j.itemCode} ほか: ${j.skuSummary.message}` : j.itemCode})。「Yahooに反映」で公開できます`);
    } catch (e) { setErr("通信エラー: " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };

  const submitYahoo = async () => {
    setBusy(true); reset();
    try {
      const res = await fetch(`/api/register/yahoo/${productId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submit: true }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `反映失敗 (HTTP ${res.status})`); return; }
      setMsg(j.submitted ? "✓ Yahooに反映しました（公開）" : `登録は成功、反映は保留: ${j.submitMessage}`);
    } catch (e) { setErr("通信エラー: " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">🚀 モールAPI登録</div>

      <div className="flex gap-1 text-sm">
        {(["rakuten", "yahoo"] as Mall[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMall(m); setPreview(null); reset(); }}
            className={`flex-1 rounded-t border-b-2 px-2 py-1 font-medium ${mall === m ? "border-red-500 text-red-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {m === "rakuten" ? "楽天" : "Yahoo"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={runDryRun} disabled={busy} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
          {busy ? "..." : "登録内容を確認"}
        </button>
        <button onClick={register} disabled={busy || !preview || !preview.valid} className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {mall === "rakuten" ? "楽天に登録" : "Yahooに登録"}
        </button>
        {mall === "yahoo" && (
          <button onClick={submitYahoo} disabled={busy} className="rounded border border-rose-400 text-rose-700 px-3 py-2 text-sm hover:bg-rose-50 disabled:opacity-50">
            Yahooに反映
          </button>
        )}
      </div>

      {preview && (
        <div className={`text-xs rounded p-2 ${preview.valid ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-800"}`}>
          <div>対象: <span className="font-mono">{preview.key}</span> / {preview.willOverwrite ? "⚠ 既存を上書き" : "新規登録"}</div>
          {/* 楽天: 送信する画像パス一覧（実在しないパスへの差し替え事故に事前に気付くための表示） */}
          {mall === "rakuten" && (() => {
            const locs = ((preview.body as { images?: { location?: string }[] } | undefined)?.images ?? [])
              .map((im) => im?.location)
              .filter((s): s is string => !!s);
            return locs.length > 0 ? (
              <div className="mt-0.5 text-slate-500">
                送信画像（{locs.length}枚）: <span className="font-mono break-all">{locs.join(" ")}</span>
              </div>
            ) : null;
          })()}
          {(preview.skuCount ?? 1) > 1 && (
            <div>Yahooは{preview.skuCount}SKUに分けて登録します（item_code=各SKUのNEコード）</div>
          )}
          {!preview.valid && <div>必須不足: {preview.missing.join(", ")}</div>}
          {preview.valid && <div className="text-green-700">✓ 必須項目OK。「登録」で送信します</div>}
        </div>
      )}

      <p className="text-xs text-slate-500">
        CSVダウンロードと併用できます（APIが使えない時はCSVへ退避）。
        {mall === "rakuten" ? "楽天はジャンル必須属性が「商品属性」に必要です。" : "Yahooは画像を先にアップロードしてください。"}
      </p>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
    </div>
  );
}
