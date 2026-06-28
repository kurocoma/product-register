"use client";

import { useState } from "react";
import Link from "next/link";

type RelatedSet = {
  set_ne_code: string;
  set_name: string;
  set_price: number | null;
  components: { ne_code: string; suryo: number }[];
  mall_codes: Record<string, string>;
  matched_singles: string[];
  missing_link: boolean;
};

type Mall = "rakuten" | "yahoo";
const MALL_LABEL: Record<Mall, string> = { rakuten: "楽天", yahoo: "Yahoo" };

/** 商品一覧の検索窓。単品コード/JANを入れると、それを含むセット商品を NEマスタ から引き、
 * 各セットの楽天/Yahoo商品コードからアプリへ取込む（/api/masters/related + /api/import/[mall]）。 */
export function RelatedImportSearch() {
  const [input, setInput] = useState("");
  const [sets, setSets] = useState<RelatedSet[] | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, { productId: string; existed: boolean }>>({});
  const [bulk, setBulk] = useState<{ running: boolean; mall: Mall; done: number; total: number; ok: number; ng: number } | null>(null);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q) {
      setErr("単品コード/JANを入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setSets(null);
    setDone({});
    try {
      const res = await fetch("/api/masters/related", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || `検索失敗 (HTTP ${res.status})`);
        return;
      }
      setSets(j.sets as RelatedSet[]);
      setNotFound(j.notFound ?? []);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  /** 表示中の全セットを指定モールから順次取込む（取込済みはスキップ）。失敗(モール未掲載等)は件数に集計。 */
  const importAll = async (mall: Mall) => {
    if (!sets || bulk?.running) return;
    const targets = sets
      .map((s) => ({ s, code: s.mall_codes[mall] || s.set_ne_code }))
      .filter((x) => x.code);
    setErr(null);
    setBulk({ running: true, mall, done: 0, total: targets.length, ok: 0, ng: 0 });
    for (let i = 0; i < targets.length; i++) {
      const { s, code } = targets[i];
      const key = `${s.set_ne_code}:${mall}`;
      let ok = !!done[key];
      if (!ok) {
        try {
          const res = await fetch(`/api/import/${mall}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const j = await res.json();
          if (res.ok && j.ok) {
            setDone((prev) => ({ ...prev, [key]: { productId: j.productId, existed: !!j.existed } }));
            ok = true;
          }
        } catch {
          /* 失敗はngに集計 */
        }
      }
      setBulk((b) => (b ? { ...b, done: i + 1, ok: b.ok + (ok ? 1 : 0), ng: b.ng + (ok ? 0 : 1) } : b));
    }
    setBulk((b) => (b ? { ...b, running: false } : b));
  };

  const importFromMall = async (mall: Mall, code: string, key: string) => {
    setImporting(key);
    setErr(null);
    try {
      const res = await fetch(`/api/import/${mall}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(`取込失敗（${MALL_LABEL[mall]}: ${code}）: ${j.error || `HTTP ${res.status}`}`);
        return;
      }
      setDone((prev) => ({ ...prev, [key]: { productId: j.productId, existed: !!j.existed } }));
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">🧩 関連商品（セット）をモールから取込</div>
      <p className="text-xs text-slate-500">
        値上げ対象の単品コード/JANを入れると、それを構成に含む<strong>セット商品</strong>を NEマスタ から引き、
        楽天/Yahoo の商品コードからアプリへ取り込みます。
      </p>
      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例: n050-3426-1 または 4582469493426（単品コード/JAN）"
          disabled={busy}
          className="flex-1 min-w-[18rem] rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
        />
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? "検索中…" : "関連セットを検索"}
        </button>
      </form>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {notFound.length > 0 && (
        <p className="text-sm text-amber-700">未解決（マスタに無い）: <span className="font-mono">{notFound.join(", ")}</span></p>
      )}
      {sets && sets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">該当セット {sets.length} 件</span>
          <button
            onClick={() => importAll("rakuten")}
            disabled={bulk?.running}
            className="rounded bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700 disabled:opacity-50"
          >
            すべて楽天から取込
          </button>
          <button
            onClick={() => importAll("yahoo")}
            disabled={bulk?.running}
            className="rounded bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            すべてYahooから取込
          </button>
          {bulk && (
            <span className={bulk.running ? "text-blue-700" : "text-slate-600"}>
              {bulk.running ? `取込中… ${bulk.done}/${bulk.total}（${MALL_LABEL[bulk.mall]}）` : `完了（${MALL_LABEL[bulk.mall]}）: 成功 ${bulk.ok} 件 / 失敗 ${bulk.ng} 件`}
            </span>
          )}
        </div>
      )}
      {sets && sets.length === 0 && <div className="text-sm text-slate-600">該当セット 0 件</div>}

      {sets && sets.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">セット商品コード</th>
                <th className="px-2 py-2">セット名</th>
                <th className="px-2 py-2 text-right">販売価格</th>
                <th className="px-2 py-2">構成品（コード×数量）</th>
                <th className="px-2 py-2">取込</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => {
                return (
                  <tr key={s.set_ne_code} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 font-mono">{s.set_ne_code}</td>
                    <td className="px-2 py-2 max-w-xs">{s.set_name}</td>
                    <td className="px-2 py-2 text-right">{s.set_price ?? ""}</td>
                    <td className="px-2 py-2 font-mono">
                      {s.components.map((c) => (
                        <div key={c.ne_code}>{c.ne_code}×{c.suryo}</div>
                      ))}
                    </td>
                    <td className="px-2 py-2 space-y-1">
                      {(["rakuten", "yahoo"] as Mall[]).map((m) => {
                        // モール別コードがあればそれ、無ければ NEコード(=システム連携用SKU番号)を取込コードに使う
                        const mallCode = s.mall_codes[m];
                        const code = mallCode || s.set_ne_code;
                        const key = `${s.set_ne_code}:${m}`;
                        const d = done[key];
                        if (d) {
                          return (
                            <div key={m}>
                              <Link href={`/products/${d.productId}`} className="text-green-700 hover:underline">
                                ✓ {MALL_LABEL[m]}取込{d.existed ? "(既存)" : ""} → 開く
                              </Link>
                            </div>
                          );
                        }
                        return (
                          <div key={m}>
                            <button
                              onClick={() => importFromMall(m, code, key)}
                              disabled={importing === key}
                              className="rounded border border-blue-300 text-blue-700 px-2 py-1 hover:bg-blue-50 disabled:opacity-50"
                            >
                              {importing === key ? "取込中…" : `${MALL_LABEL[m]}から取込`}
                              <span className="ml-1 text-slate-400 font-mono">{code}</span>
                              {!mallCode && <span className="ml-1 text-amber-600">(NEコード試行)</span>}
                            </button>
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
