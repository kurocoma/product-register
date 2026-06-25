"use client";

import { useState } from "react";

type SourceDef = { key: string; source: string; mall?: string; label: string; hint: string };

const SOURCES: SourceDef[] = [
  { key: "ne-syohin", source: "ne-syohin", label: "NE 商品マスタ（単品）", hint: "syohin_basic*.csv（売価・税率・在庫）" },
  { key: "ne-set", source: "ne-set", label: "NE セット商品マスタ", hint: "set_syohin*.csv（セット構成・セット売価）" },
  { key: "ne-himoduke", source: "ne-himoduke", label: "NE 紐づけ表", hint: "himoduke*.csv（在庫連携・代表商品コード）" },
  { key: "excel-master", source: "excel-master", label: "Excel 商品マスタ", hint: "from-excel/excel_syohin_master.csv（JAN・原価・カテゴリ）" },
  { key: "excel-discon", source: "excel-discon", label: "Excel 終売品マスタ", hint: "from-excel/excel_discon.csv（終売フラグ）" },
  { key: "excel-mall-rakuten", source: "excel-mall", mall: "rakuten", label: "Excel 商品コード一覧 楽天", hint: "from-excel/excel_mall_rakuten.csv" },
  { key: "excel-mall-yahoo", source: "excel-mall", mall: "yahoo", label: "Excel 商品コード一覧 Yahoo", hint: "from-excel/excel_mall_yahoo.csv" },
  { key: "excel-mall-amazon", source: "excel-mall", mall: "amazon", label: "Excel 商品コード一覧 amazon", hint: "from-excel/excel_mall_amazon.csv" },
  { key: "excel-mall-shimanoya", source: "excel-mall", mall: "shimanoya", label: "Excel しまのや商品コード一覧", hint: "from-excel/excel_mall_shimanoya.csv" },
];

/** 取込結果(JSON)を人間向けの短い文字列にする。 */
function summarize(j: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof j.inserted === "number") parts.push(`新規 ${j.inserted}`);
  if (typeof j.updated === "number") parts.push(`更新 ${j.updated}`);
  if (j.items && typeof j.items === "object") {
    const it = j.items as { inserted?: number; updated?: number };
    parts.push(`商品 新規${it.inserted ?? 0}/更新${it.updated ?? 0}`);
  }
  if (typeof j.composition === "number") parts.push(`構成 ${j.composition}`);
  if (typeof j.upserted === "number") parts.push(`登録 ${j.upserted}`);
  if (typeof j.unmatched === "number" && j.unmatched > 0) parts.push(`未解決 ${j.unmatched}`);
  return parts.join(" / ") || "完了";
}

function SourceUploader({ def }: { def: SourceDef }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const run = async () => {
    if (!file) {
      setErr("CSVファイルを選択してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const q = def.mall ? `?mall=${def.mall}` : "";
      const res = await fetch(`/api/masters/import/${def.source}${q}`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || `取込失敗 (HTTP ${res.status})`);
        return;
      }
      setMsg("✓ " + summarize(j));
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded p-3 space-y-2 bg-white">
      <div className="font-medium text-sm">{def.label}</div>
      <div className="text-xs text-slate-500">{def.hint}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button
          onClick={run}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "取込中…" : "取込"}
        </button>
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
    </div>
  );
}

export function MasterImportPanel() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="font-semibold">① NE マスタ（CSVをそのまま）</div>
        <div className="grid gap-2 md:grid-cols-3">
          {SOURCES.filter((s) => s.key.startsWith("ne-")).map((s) => (
            <SourceUploader key={s.key} def={s} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="font-semibold">② Excel（先に <code>python tools/excel_to_csv.py</code> でCSV化）</div>
        <div className="grid gap-2 md:grid-cols-3">
          {SOURCES.filter((s) => s.key.startsWith("excel-")).map((s) => (
            <SourceUploader key={s.key} def={s} />
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        取込はソースごとに独立して何度でも可能（冪等マージ）。CP932/UTF-8 自動判定。
        Yahoo/Amazon は商品番号列が無いため一部「未解決」になることがあります（紐づけ漏れの手掛かり）。
      </p>
    </div>
  );
}
