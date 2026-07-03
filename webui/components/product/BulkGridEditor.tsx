"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { upsertProduct } from "@/lib/product/repository";
import {
  GRID_COLUMNS,
  type GridColumnKey,
  type GridRow,
  applyFieldChange,
  emptyGridRow,
  expandSetRows,
  gridRowToProductInput,
  isRowBlank,
  parseQuantities,
  parseTsv,
  validateGridRows,
} from "@/lib/product/grid-rows";
import { Button } from "@/components/ui/button";

type RowState = {
  uid: number;
  data: GridRow;
  /** 保存済み products.id。2回目以降の保存は更新（重複登録しない）。 */
  savedId?: string;
  /** 直近の保存結果（行別の成功/失敗理由） */
  result?: { ok: boolean; message: string };
};

let uidSeq = 1;
const newRow = (data?: GridRow): RowState => ({ uid: uidSeq++, data: data ?? emptyGridRow() });

const cellId = (rowIndex: number, key: string) => `bulkgrid-${rowIndex}-${key}`;

export function BulkGridEditor() {
  const [rows, setRows] = useState<RowState[]>(() => [newRow(), newRow(), newRow()]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState("");
  const pendingFocusRef = useRef<{ rowIndex: number; key: string } | null>(null);

  // 行追加直後の Enter 移動先へフォーカス（新しい行の描画完了後に実行）
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    document.getElementById(cellId(target.rowIndex, target.key))?.focus();
  }, [rows]);

  const validation = useMemo(() => validateGridRows(rows.map((r) => r.data)), [rows]);
  const filledCount = useMemo(() => rows.filter((r) => !isRowBlank(r.data)).length, [rows]);

  const editCell = (rowIndex: number, key: GridColumnKey, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, data: applyFieldChange(r.data, key, value), result: undefined } : r)),
    );
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const removeRow = (rowIndex: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== rowIndex);
      return next.length === 0 ? [newRow()] : next;
    });
  };

  /** 単品行からセット行を自動展開（省力化）。数量以外の共通項目は引き継ぎ、価格だけ入力する。 */
  const addSetRows = (rowIndex: number) => {
    const text = window.prompt("追加するセットの数量をカンマ区切りで入力してください（例: 6,24,48）", "6,24,48");
    if (text == null) return;
    const quantities = parseQuantities(text);
    if (quantities.length === 0) {
      window.alert("数量を読み取れませんでした。「6,24,48」のように 1 以上の整数で入力してください。");
      return;
    }
    setRows((prev) => {
      const source = prev[rowIndex];
      if (!source) return prev;
      const inserted = expandSetRows(source.data, quantities).map((d) => newRow(d));
      return [...prev.slice(0, rowIndex + 1), ...inserted, ...prev.slice(rowIndex + 1)];
    });
  };

  const importTsv = (text: string) => {
    const imported = parseTsv(text);
    if (imported.length === 0) {
      setSummary("貼り付け内容から行を読み取れませんでした。Excel の行（B列〜S列）をコピーして貼り付けてください。");
      return;
    }
    setRows((prev) => {
      const kept = prev.filter((r) => !isRowBlank(r.data));
      return [...kept, ...imported.map((d) => newRow(d))];
    });
    setPasteText("");
    setPasteOpen(false);
    setSummary(`${imported.length} 行を取り込みました。内容を確認して「一括保存」してください。`);
  };

  /** Enter で1つ下の行の同じ列へ（最終行なら行を追加してから）。Excel と同じ操作感。 */
  const onCellKeyDown = (e: React.KeyboardEvent, rowIndex: number, key: GridColumnKey) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (rowIndex === rows.length - 1) {
      pendingFocusRef.current = { rowIndex: rowIndex + 1, key };
      addRow();
    } else {
      document.getElementById(cellId(rowIndex + 1, key))?.focus();
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSummary("");
    const supabase = createClient();
    let ok = 0;
    let ng = 0;
    const current = rows;
    const results = new Map<number, { ok: boolean; message: string; savedId?: string }>();

    for (let i = 0; i < current.length; i++) {
      const r = current[i];
      if (isRowBlank(r.data)) continue;
      const errors = validation.get(i);
      if (errors && errors.length > 0) {
        results.set(r.uid, { ok: false, message: `入力エラー: ${errors.join(" / ")}` });
        ng++;
        continue;
      }
      try {
        const input = gridRowToProductInput(r.data);
        const saved = await upsertProduct(supabase, input, r.savedId);
        results.set(r.uid, { ok: true, message: r.savedId ? "更新しました" : "登録しました", savedId: saved.id });
        ok++;
      } catch (e) {
        results.set(r.uid, { ok: false, message: e instanceof Error ? e.message : String(e) });
        ng++;
      }
    }

    setRows((prev) =>
      prev.map((r) => {
        const res = results.get(r.uid);
        if (!res) return r;
        return { ...r, savedId: res.savedId ?? r.savedId, result: { ok: res.ok, message: res.message } };
      }),
    );
    setSummary(`保存結果: 成功 ${ok} 件 / 失敗 ${ng} 件${ng > 0 ? "（失敗行の理由は右端の「状態」列を確認）" : ""}`);
    setSaving(false);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">一括登録（まとめて入力）</h1>
        <p className="mt-1 text-sm text-slate-600">
          Excel のデータ入力シートと同じ列構成で、複数商品をまとめて登録できます。
          保存した商品は<Link href="/products" className="text-blue-600 hover:underline">商品一覧</Link>に表示され、
          モール（楽天 / Yahoo）への一括登録・一括反映は商品一覧で対象商品を選択して実行します。
        </p>
        <ul className="mt-2 text-xs text-slate-500 list-disc pl-5 space-y-0.5">
          <li>NEコードはメーカーコード・JAN・数量から自動生成されます（手修正も可能）。掲載商品名は商品名から自動補完されます。</li>
          <li>単品行の「セット行」ボタンで、数量違いのセット商品行を自動展開できます（販売価格だけ入力すれば OK）。</li>
          <li>Enter キーで下の行へ移動します（Excel と同じ操作感。最終行では行が自動追加されます）。</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={addRow}>+ 行を追加</Button>
        <Button variant="outline" onClick={() => setPasteOpen((v) => !v)}>
          📋 Excel から貼り付け取込
        </Button>
        <Button onClick={save} disabled={saving || filledCount === 0}>
          {saving ? "保存中…" : `一括保存（${filledCount} 行）`}
        </Button>
        {summary && <span className="text-sm text-slate-700">{summary}</span>}
      </div>

      {pasteOpen && (
        <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
          <p className="text-sm text-slate-600">
            Excel のデータ入力シートで行（NEコード〜キャッチコピー(Yahoo) の列）を選択してコピーし、下の枠に貼り付けてください。
            見出し行や左端の空列が含まれていても自動で読み飛ばします。NEコード・掲載商品名が空欄なら自動補完します。
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (text.includes("\t") || text.includes("\n")) {
                e.preventDefault();
                importTsv(text);
              }
            }}
            placeholder="ここに Ctrl+V で貼り付け（貼り付けと同時に取り込みます）"
            className="w-full h-28 rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => importTsv(pasteText)} disabled={pasteText.trim() === ""}>
              取り込んで行に追加
            </Button>
            <Button variant="ghost" onClick={() => { setPasteText(""); setPasteOpen(false); }}>閉じる</Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded border border-slate-200 overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-2 py-2 text-left text-slate-500 sticky left-0 bg-slate-100 z-10">#</th>
              {GRID_COLUMNS.map((col) => (
                <th key={col.key} className="px-1 py-2 text-left whitespace-nowrap" title={col.autoHint ?? ""}>
                  <span className={col.width + " inline-block px-1"}>
                    {col.label}
                    {col.required && <span className="text-red-500 ml-0.5">*</span>}
                    {col.autoHint && <span className="text-blue-500 ml-0.5" title={col.autoHint}>⚡</span>}
                  </span>
                </th>
              ))}
              <th className="px-2 py-2 text-left whitespace-nowrap">操作</th>
              <th className="px-2 py-2 text-left whitespace-nowrap min-w-40">状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIndex) => {
              const errors = validation.get(rowIndex) ?? [];
              const blank = isRowBlank(r.data);
              return (
                <tr key={r.uid} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1 text-slate-400 sticky left-0 bg-white z-10">{rowIndex + 1}</td>
                  {GRID_COLUMNS.map((col) => {
                    const value = r.data[col.key];
                    const cellClass =
                      "w-full rounded border px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 " +
                      (!blank && errors.length > 0 ? "border-red-200 " : "border-slate-200 ") +
                      (col.key === "ne_code" || col.key === "jan_code" ? "font-mono " : "");
                    return (
                      <td key={col.key} className="px-1 py-1">
                        <div className={col.width}>
                          {col.input === "select" ? (
                            <select
                              id={cellId(rowIndex, col.key)}
                              value={value}
                              onChange={(e) => editCell(rowIndex, col.key, e.target.value)}
                              onKeyDown={(e) => onCellKeyDown(e, rowIndex, col.key)}
                              className={cellClass + "bg-white"}
                            >
                              {(col.options ?? []).includes(value) ? null : <option value={value}>{value}</option>}
                              {(col.options ?? []).map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={cellId(rowIndex, col.key)}
                              type="text"
                              inputMode={col.input === "number" ? "numeric" : undefined}
                              value={value}
                              onChange={(e) => editCell(rowIndex, col.key, e.target.value)}
                              onKeyDown={(e) => onCellKeyDown(e, rowIndex, col.key)}
                              className={cellClass + (col.input === "number" ? "text-right" : "")}
                            />
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="flex gap-1">
                      <button
                        onClick={() => addSetRows(rowIndex)}
                        disabled={blank}
                        title="この行を元に、数量違いのセット商品行を下へ自動展開します（販売価格だけ入力すれば OK）"
                        className="rounded border border-amber-300 px-1.5 py-0.5 text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        セット行
                      </button>
                      <button
                        onClick={() => removeRow(rowIndex)}
                        title="この行を削除"
                        className="rounded border border-slate-200 px-1.5 py-0.5 text-red-600 hover:bg-red-50"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-1 min-w-40">
                    {r.result ? (
                      <span className={r.result.ok ? "text-green-700" : "text-red-600"}>
                        {r.result.ok ? `✓ ${r.result.message}` : r.result.message}
                      </span>
                    ) : r.savedId ? (
                      <span className="text-green-700">✓ 保存済（再保存で更新）</span>
                    ) : !blank && errors.length > 0 ? (
                      <ul className="text-red-600 space-y-0.5 list-disc pl-4">
                        {errors.map((msg) => (
                          <li key={msg}>{msg}</li>
                        ))}
                      </ul>
                    ) : blank ? (
                      <span className="text-slate-300">未入力</span>
                    ) : (
                      <span className="text-slate-500">保存可能</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
