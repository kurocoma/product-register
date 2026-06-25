"use client";

import { useState } from "react";
import { relatedToCsv, type RelatedSet } from "@/lib/ne-master/related";

const MALLS: { key: string; label: string }[] = [
  { key: "rakuten", label: "楽天" },
  { key: "yahoo", label: "Yahoo" },
  { key: "amazon", label: "Amazon" },
  { key: "shimanoya", label: "しまのや" },
];

export function RelatedSearchPanel() {
  const [input, setInput] = useState("");
  const [sets, setSets] = useState<RelatedSet[] | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setErr(null);
    setSets(null);
    try {
      const res = await fetch("/api/masters/related", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
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

  const downloadCsv = () => {
    if (!sets) return;
    const csv = relatedToCsv(sets);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "related_sets.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={"値上げ対象の単品コード/JANを改行・カンマ区切りで貼り付け\n例: n050-3426-1\n4582469493426"}
        rows={5}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={search} disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? "検索中…" : "関連セットを検索"}
        </button>
        {sets && sets.length > 0 && (
          <button onClick={downloadCsv} className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
            ⬇ CSVダウンロード
          </button>
        )}
      </div>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
      {notFound.length > 0 && (
        <p className="text-sm text-amber-700">未解決（マスタに無い）: <span className="font-mono">{notFound.join(", ")}</span></p>
      )}

      {sets && (
        <div className="text-sm text-slate-600">該当セット {sets.length} 件</div>
      )}
      {sets && sets.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">元単品</th>
                <th className="px-2 py-2">セット商品コード</th>
                <th className="px-2 py-2">セット商品名</th>
                <th className="px-2 py-2 text-right">販売価格</th>
                <th className="px-2 py-2">構成品（コード×数量）</th>
                {MALLS.map((m) => <th key={m.key} className="px-2 py-2">{m.label}</th>)}
                <th className="px-2 py-2">紐づけ漏れ</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.set_ne_code} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 font-mono">{s.matched_singles.join(", ")}</td>
                  <td className="px-2 py-2 font-mono">{s.set_ne_code}</td>
                  <td className="px-2 py-2 max-w-xs">{s.set_name}</td>
                  <td className="px-2 py-2 text-right">{s.set_price ?? ""}</td>
                  <td className="px-2 py-2 font-mono">
                    {s.components.map((c) => `${c.ne_code}×${c.suryo}`).join("\n").split("\n").map((line, i) => <div key={i}>{line}</div>)}
                  </td>
                  {MALLS.map((m) => <td key={m.key} className="px-2 py-2 font-mono">{s.mall_codes[m.key] ?? ""}</td>)}
                  <td className="px-2 py-2 text-center">{s.missing_link ? <span className="text-red-600">○</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
