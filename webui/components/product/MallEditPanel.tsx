"use client";

import { useState } from "react";

type Mall = "rakuten" | "yahoo";
type Changed = { field: string; before: unknown; after: unknown };
type DiffPreview = { changedFields: Changed[]; skipped: string[]; advanced: string[]; hasChanges: boolean; key: string };

/** 編集対象フィールドの日本語ラベル。 */
const FIELD_LABEL: Record<string, string> = {
  display_name: "商品名",
  selling_price: "販売価格",
  description_pc: "商品説明(PC)",
  description_sp: "商品説明(SP)",
  catch_copy_pc: "キャッチコピー",
  catch_copy_yahoo: "キャッチコピー",
  mall_category_id: "カテゴリ",
  yahoo_category_id: "カテゴリ",
  jan_code: "JANコード",
  shipping_type: "送料区分",
  image_count: "画像枚数",
};
const label = (f: string) => FIELD_LABEL[f] ?? f;

/** 既存のモール商品をAPIで取込→差分確認→部分反映するパネル。
 * 取込(fetch): モール現状をアプリ商品へ取り込む。差分(update GET): 変更点を確認。反映(update POST): 変更分のみ送信。 */
export function MallEditPanel({ productId }: { productId?: string }) {
  const [mall, setMall] = useState<Mall>("rakuten");
  const [diff, setDiff] = useState<DiffPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!productId) {
    return (
      <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-500">
        💡 商品を保存すると、モール既存商品の取込・更新が有効になります
      </div>
    );
  }

  const reset = () => { setMsg(null); setErr(null); };

  // 取込: モール現状をアプリ商品へ反映（保存値を上書き）。成功後リロードしてフォームへ反映。
  const importFromMall = async () => {
    if (!confirm(`${mall === "rakuten" ? "楽天" : "Yahoo"}の現在の商品内容をこの商品に取り込みます。保存中の内容は上書きされます。続けますか？`)) return;
    setBusy(true); reset(); setDiff(null);
    try {
      const res = await fetch(`/api/fetch/${mall}/${productId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `取込失敗 (HTTP ${res.status})`); return; }
      setMsg(`✓ ${mall === "rakuten" ? "楽天" : "Yahoo"}から取り込みました (${j.key})。画面を更新します…`);
      setTimeout(() => window.location.reload(), 600);
    } catch (e) { setErr("通信エラー: " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };

  // 差分確認: 保存済みアプリ商品 vs モール現状。
  const checkDiff = async () => {
    setBusy(true); reset(); setDiff(null);
    try {
      const res = await fetch(`/api/update/${mall}/${productId}`);
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `差分確認失敗 (HTTP ${res.status})`); return; }
      setDiff({ changedFields: j.changedFields || [], skipped: j.skipped || [], advanced: j.advanced || [], hasChanges: j.hasChanges, key: j.key });
    } catch (e) { setErr("通信エラー: " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };

  // 反映: 変更分のみ送信（楽天=items.patch / Yahoo=editItemラウンドトリップ）。
  const applyUpdate = async (submit: boolean) => {
    if (!diff || !diff.hasChanges) return;
    if (!confirm(`「${diff.key}」に ${diff.changedFields.length}件の変更を反映します。よろしいですか？`)) return;
    setBusy(true); reset();
    try {
      const res = await fetch(`/api/update/${mall}/${productId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submit }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || `反映失敗 (HTTP ${res.status})`); return; }
      const sub = mall === "yahoo" ? (j.submitted ? "（公開反映済み）" : submit ? `（反映保留: ${j.submitMessage}）` : "") : "";
      setMsg(`✓ ${mall === "rakuten" ? "楽天" : "Yahoo"}へ反映しました (${(j.changedFields || []).map(label).join(", ")})${sub}`);
      setDiff(null);
    } catch (e) { setErr("通信エラー: " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">✏️ モール既存商品の編集（取込→差分→反映）</div>

      <div className="flex gap-1 text-sm">
        {(["rakuten", "yahoo"] as Mall[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMall(m); setDiff(null); reset(); }}
            className={`flex-1 rounded-t border-b-2 px-2 py-1 font-medium ${mall === m ? "border-blue-500 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {m === "rakuten" ? "楽天" : "Yahoo"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={importFromMall} disabled={busy} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
          {busy ? "..." : "⬇ モールから取込"}
        </button>
        <button onClick={checkDiff} disabled={busy} className="rounded border border-blue-300 text-blue-700 px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-50">
          差分を確認
        </button>
        <button onClick={() => applyUpdate(false)} disabled={busy || !diff || !diff.hasChanges} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {mall === "rakuten" ? "楽天へ反映" : "Yahooへ反映"}
        </button>
        {mall === "yahoo" && (
          <button onClick={() => applyUpdate(true)} disabled={busy || !diff || !diff.hasChanges} className="rounded border border-blue-400 text-blue-700 px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-50">
            反映して公開(submit)
          </button>
        )}
      </div>

      {diff && (
        <div className="text-xs rounded p-2 bg-slate-50 text-slate-700 space-y-1">
          <div>対象: <span className="font-mono">{diff.key}</span></div>
          {diff.advanced.length > 0 && (
            <div className="text-red-700">⚠ API更新で保持できない設定（{diff.advanced.join(", ")}）を含むため、反映できません。ストア管理画面で更新してください。</div>
          )}
          {!diff.hasChanges && <div className="text-slate-500">変更はありません</div>}
          {diff.hasChanges && (
            <ul className="space-y-0.5">
              {diff.changedFields.map((c) => (
                <li key={c.field} className="flex flex-wrap gap-1">
                  <span className="font-medium">{label(c.field)}:</span>
                  <span className="text-slate-400 line-through break-all">{String(c.before ?? "")}</span>
                  <span>→</span>
                  <span className="text-blue-700 break-all">{String(c.after ?? "")}</span>
                </li>
              ))}
            </ul>
          )}
          {diff.skipped.length > 0 && (
            <div className="text-amber-700">※ この方法では反映しない項目: {diff.skipped.map(label).join(", ")}（画像・在庫は別操作）</div>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        差分・反映は「保存済みの内容」とモール現状を比較します（自動保存後に実行してください）。
        変更された項目だけを送信し、それ以外は維持します。
      </p>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
    </div>
  );
}
