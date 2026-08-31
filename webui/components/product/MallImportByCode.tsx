"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mall = "rakuten" | "yahoo" | "shopify";
const MALL_LABEL: Record<Mall, string> = { rakuten: "楽天", yahoo: "Yahoo", shopify: "Shopify" };

type SearchResult = { code: string; name: string; note?: string };

/** 商品管理番号（または商品名検索）でモール既存ページから取込み、新規商品として作成→編集画面へ遷移する。
 *  同じ NEコードの商品が既にあれば（重複作成せず）その編集画面を開く。
 *  商品名検索（260901修正依頼-1）: GET /api/import/[mall]/search で候補を出し、選んだ候補を従来の取込へ渡す。 */
export function MallImportByCode() {
  const router = useRouter();
  const [mall, setMall] = useState<Mall>("rakuten");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const resetFeedback = () => {
    setErr(null);
    setMsg(null);
  };

  const importCode = async (c: string) => {
    if (!c) {
      setErr("商品管理番号を入力してください");
      return;
    }
    setBusy(true);
    resetFeedback();
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await importCode(code.trim());
  };

  const searchByName = async () => {
    const q = code.trim();
    if (!q) {
      setErr("検索する商品名を入力してください");
      return;
    }
    setSearching(true);
    resetFeedback();
    setResults(null);
    setHint(null);
    try {
      const res = await fetch(`/api/import/${mall}/search?q=${encodeURIComponent(q)}`);
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || `検索失敗 (HTTP ${res.status})`);
        return;
      }
      setResults(j.results ?? []);
      if (typeof j.hint === "string") setHint(j.hint);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSearching(false);
    }
  };

  const placeholder =
    mall === "rakuten"
      ? "例: maker-1234（商品管理番号）または商品名"
      : mall === "shopify"
        ? "例: 1234567890（商品の数値ID）または商品名"
        : "例: item-code（商品コード）または商品名";

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">⬇ モール既存商品を取込んで編集</div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex text-sm">
          {(["rakuten", "yahoo", "shopify"] as Mall[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMall(m);
                resetFeedback();
                setResults(null);
                setHint(null);
              }}
              className={`rounded-t border-b-2 px-3 py-1 font-medium ${
                mall === m ? "border-blue-500 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {MALL_LABEL[m]}
            </button>
          ))}
        </div>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={placeholder}
          disabled={busy || searching}
          className="flex-1 min-w-[16rem] rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={busy || searching}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "取込中…" : "取込んで編集"}
        </button>

        <button
          type="button"
          onClick={searchByName}
          disabled={busy || searching}
          className="rounded border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {searching ? "検索中…" : "🔍 商品名で検索"}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        {mall === "rakuten"
          ? "楽天の「商品管理番号（商品URL）」で取込むか、「商品名で検索」から候補を選んで取込めます。"
          : mall === "shopify"
            ? "Shopify の「商品ID（管理画面 /products/ 末尾の数値）」で取込むか、「商品名で検索」から候補を選んで取込めます。"
            : "Yahoo の「商品コード」で取込むか、「商品名で検索」から候補を選んで取込めます。"}
      </p>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}

      {results && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">
            検索結果 {results.length}件{hint ? `（${hint}）` : ""}
          </p>
          {results.length === 0 ? (
            <p className="text-sm text-slate-500">該当する商品が見つかりませんでした。</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded">
              {results.map((r) => (
                <li key={r.code} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-mono text-slate-700 shrink-0">{r.code}</span>
                  <span className="flex-1 truncate" title={r.name}>
                    {r.name}
                  </span>
                  {r.note && <span className="text-xs text-slate-400 shrink-0">{r.note}</span>}
                  <button
                    type="button"
                    disabled={busy || searching}
                    onClick={() => {
                      setCode(r.code);
                      void importCode(r.code);
                    }}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
                  >
                    取込んで編集
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
