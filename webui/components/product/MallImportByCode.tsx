"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mall = "rakuten" | "yahoo";

/** 商品管理番号を入力してモール既存ページから取込み、新規商品として作成→編集画面へ遷移する。
 *  同じ NEコードの商品が既にあれば（重複作成せず）その編集画面を開く。 */
export function MallImportByCode() {
  const router = useRouter();
  const [mall, setMall] = useState<Mall>("rakuten");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) {
      setErr("商品管理番号を入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/import/${mall}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || `取込失敗 (HTTP ${res.status})`);
        return;
      }
      setMsg(j.existed ? "✓ 既存の商品を開きます…" : "✓ 取込して新規作成しました。編集画面を開きます…");
      router.push(`/products/${j.productId}`);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const placeholder = mall === "rakuten" ? "例: maker-1234（商品管理番号）" : "例: item-code（商品コード）";

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">⬇ モール既存商品を取込んで編集</div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex text-sm">
          {(["rakuten", "yahoo"] as Mall[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMall(m);
                setErr(null);
                setMsg(null);
              }}
              className={`rounded-t border-b-2 px-3 py-1 font-medium ${
                mall === m ? "border-blue-500 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {m === "rakuten" ? "楽天" : "Yahoo"}
            </button>
          ))}
        </div>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 min-w-[16rem] rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "取込中…" : "取込んで編集"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        {mall === "rakuten"
          ? "楽天の「商品管理番号（商品URL）」を入力すると、現在の登録内容を取り込んで新規商品として作成し、編集画面を開きます。"
          : "Yahoo の「商品コード」を入力すると、現在の登録内容を取り込んで新規商品として作成し、編集画面を開きます。"}
      </p>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
    </form>
  );
}
