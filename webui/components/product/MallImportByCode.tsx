"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mall = "rakuten" | "yahoo" | "shopify";
const MALL_LABEL: Record<Mall, string> = { rakuten: "楽天", yahoo: "Yahoo", shopify: "Shopify" };

type SearchResult = { code: string; name: string; note?: string };
/** まとめて取込の行別結果（created=新規作成 / existed=既存を検出 / error=失敗）。 */
type RowResult = { status: "created" | "existed" | "error"; message?: string };

/** 商品管理番号（または商品名検索）でモール既存ページから取込み、新規商品として作成→編集画面へ遷移する。
 *  同じ NEコードの商品が既にあれば（重複作成せず）その編集画面を開く。
 *  商品名検索（260901修正依頼-1）: GET /api/import/[mall]/search で候補を出し、選んだ候補を従来の取込へ渡す。
 *  まとめて取込（260901追記）: 候補にチェックを付けて一括取込。1件ずつ順番に既存の取込APIを呼び、
 *  行別に 新規/既存/失敗 を表示する（編集画面へは遷移せず、完了後に商品一覧を更新する）。 */
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowResults, setRowResults] = useState<Record<string, RowResult>>({});
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number } | null>(null);

  const resetFeedback = () => {
    setErr(null);
    setMsg(null);
  };

  const clearResults = () => {
    setResults(null);
    setHint(null);
    setSelected(new Set());
    setRowResults({});
    setBulk(null);
  };

  /** 取込APIを1件呼ぶ（共通）。まとめて取込でも同じ契約を使う。 */
  const importOne = async (c: string): Promise<{ ok: boolean; existed?: boolean; productId?: string; error?: string }> => {
    try {
      const res = await fetch(`/api/import/${mall}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) return { ok: false, error: j.error || `取込失敗 (HTTP ${res.status})` };
      return { ok: true, existed: j.existed === true, productId: j.productId };
    } catch (e) {
      return { ok: false, error: "通信エラー: " + (e instanceof Error ? e.message : String(e)) };
    }
  };

  const importCode = async (c: string) => {
    if (!c) {
      setErr("商品管理番号を入力してください");
      return;
    }
    setBusy(true);
    resetFeedback();
    const r = await importOne(c);
    if (!r.ok) {
      setErr(r.error ?? "取込失敗");
      setBusy(false);
      return;
    }
    setMsg(r.existed ? "✓ 既存の商品を開きます…" : "✓ 取込して新規作成しました。編集画面を開きます…");
    router.push(`/products/${r.productId}`);
    setBusy(false);
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
    clearResults();
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

  const toggleOne = (c: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set((results ?? []).map((r) => r.code)) : new Set());

  /** 選択した候補を1件ずつ順番に取込む（モールAPIへの並列送信を避ける）。 */
  const importSelected = async () => {
    const codes = (results ?? []).map((r) => r.code).filter((c) => selected.has(c));
    if (codes.length === 0) return;
    setBusy(true);
    resetFeedback();
    setRowResults({});
    setBulk({ running: true, done: 0, total: codes.length });
    let created = 0;
    let existed = 0;
    let failed = 0;
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const r = await importOne(c);
      if (r.ok && !r.existed) created++;
      else if (r.ok) existed++;
      else failed++;
      setRowResults((prev) => ({
        ...prev,
        [c]: r.ok ? { status: r.existed ? "existed" : "created" } : { status: "error", message: r.error },
      }));
      setBulk({ running: true, done: i + 1, total: codes.length });
    }
    setBulk({ running: false, done: codes.length, total: codes.length });
    setMsg(
      `✓ まとめて取込 完了: 新規 ${created} 件 / 既存 ${existed} 件` +
        (failed > 0 ? ` / 失敗 ${failed} 件（行の表示を確認してください）` : "") +
        "。下の商品一覧を更新しました",
    );
    // 取込んだ商品を下の商品一覧（サーバー初期データ）へ反映する
    router.refresh();
    setBusy(false);
  };

  const rowResultView = (r: RowResult | undefined) => {
    if (!r) return null;
    if (r.status === "created") return <span className="text-xs text-green-700 shrink-0">✓ 新規作成</span>;
    if (r.status === "existed") return <span className="text-xs text-slate-500 shrink-0">✓ 既存あり</span>;
    return (
      <span className="text-xs text-red-600 shrink-0 max-w-[20rem] truncate" title={r.message}>
        ⚠ {r.message}
      </span>
    );
  };

  const placeholder =
    mall === "rakuten"
      ? "例: maker-1234（商品管理番号）または商品名"
      : mall === "shopify"
        ? "例: 1234567890（商品の数値ID）または商品名"
        : "例: item-code（商品コード）または商品名";

  const allChecked = (results?.length ?? 0) > 0 && selected.size === results?.length;

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
                clearResults();
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500">
              検索結果 {results.length}件{hint ? `（${hint}）` : ""}
            </p>
            {results.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={importSelected}
                  disabled={busy || searching || selected.size === 0}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  選択した {selected.size} 件をまとめて取込
                </button>
                {bulk && (
                  <span className={`text-xs ${bulk.running ? "text-blue-700" : "text-slate-500"}`}>
                    {bulk.running ? `取込中… ${bulk.done}/${bulk.total}` : `完了 ${bulk.done}/${bulk.total}`}
                  </span>
                )}
              </>
            )}
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-slate-500">該当する商品が見つかりませんでした。</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded">
              <li className="flex items-center gap-3 px-3 py-1.5 bg-slate-50 text-xs text-slate-500">
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  checked={allChecked}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={busy || searching}
                />
                <span>すべて選択（チェックした候補は「まとめて取込」の対象になります）</span>
              </li>
              {results.map((r) => (
                <li key={r.code} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`選択（${r.code}）`}
                    checked={selected.has(r.code)}
                    onChange={() => toggleOne(r.code)}
                    disabled={busy || searching}
                  />
                  <span className="font-mono text-slate-700 shrink-0">{r.code}</span>
                  <span className="flex-1 truncate" title={r.name}>
                    {r.name}
                  </span>
                  {r.note && <span className="text-xs text-slate-400 shrink-0">{r.note}</span>}
                  {rowResultView(rowResults[r.code])}
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
