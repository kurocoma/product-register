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

/** 編集中の商品(ne_code)を含むセット商品を NEマスタ から引き、各セットの楽天/Yahoo商品コードから
 * アプリへ取込む（要件①の /api/import/[mall] を再利用）。値上げ連動でセットを一括取り込む用途。 */
export function MallRelatedImportPanel({ neCode }: { neCode?: string }) {
  const [sets, setSets] = useState<RelatedSet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, { productId: string; existed: boolean }>>({});

  if (!neCode) {
    return (
      <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-500">
        💡 商品を保存すると、関連セットのモール取込が有効になります
      </div>
    );
  }

  const load = async () => {
    setBusy(true);
    setErr(null);
    setSets(null);
    setDone({});
    try {
      const res = await fetch("/api/masters/related", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: neCode }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || `取得失敗 (HTTP ${res.status})`);
        return;
      }
      setSets(j.sets as RelatedSet[]);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
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
      <div className="font-semibold">🧩 関連商品をモールから取込（NEマスタ連携）</div>
      <p className="text-xs text-slate-500">
        この商品（NEコード <span className="font-mono">{neCode}</span>）を構成に含む<strong>セット商品</strong>を NEマスタ から引き、
        楽天/Yahoo の商品コードからアプリへ取り込みます（値上げ時のセット取込に）。
      </p>
      <button onClick={load} disabled={busy} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        {busy ? "..." : "関連セットを表示"}
      </button>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {sets && sets.length === 0 && <p className="text-sm text-slate-500">この商品を含むセットはありません</p>}

      {sets && sets.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">セット商品コード</th>
                <th className="px-2 py-2">セット名</th>
                <th className="px-2 py-2 text-right">販売価格</th>
                <th className="px-2 py-2">取込</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => {
                const malls = (["rakuten", "yahoo"] as Mall[]).filter((m) => s.mall_codes[m]);
                return (
                  <tr key={s.set_ne_code} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 font-mono">{s.set_ne_code}</td>
                    <td className="px-2 py-2 max-w-xs">{s.set_name}</td>
                    <td className="px-2 py-2 text-right">{s.set_price ?? ""}</td>
                    <td className="px-2 py-2 space-y-1">
                      {malls.length === 0 && (
                        <span className="text-slate-400">{s.missing_link ? "紐づけ漏れ（楽天/Yahooコード無し）" : "—"}</span>
                      )}
                      {malls.map((m) => {
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
                              onClick={() => importFromMall(m, s.mall_codes[m], key)}
                              disabled={importing === key}
                              className="rounded border border-blue-300 text-blue-700 px-2 py-1 hover:bg-blue-50 disabled:opacity-50"
                            >
                              {importing === key ? "取込中…" : `${MALL_LABEL[m]}から取込`}
                              <span className="ml-1 text-slate-400 font-mono">{s.mall_codes[m]}</span>
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
