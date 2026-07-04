"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GridRow } from "@/lib/product/grid-rows";
import {
  fetchGenreAttributes,
  isRequiredAttribute,
  type GenreAttribute,
} from "@/lib/product/genre-attributes";
import {
  fetchYahooCategoryMapping,
  type YahooCategoryMapping,
} from "@/lib/product/category-mapping";
import {
  applyYahooCandidate,
  applyYahooToSameCategory,
  copyAttributesToSameCategory,
  loadAttributesIntoRow,
  sameCategoryRowIndexes,
  setRowAttribute,
} from "@/lib/product/category-assist";
import { Button } from "@/components/ui/button";

/** カテゴリID 1件分の読み込み結果（読み込みボタン押下時にだけ取得。同一IDは再取得しない） */
type LoadedCategory = { attrs: GenreAttribute[]; yahoo: YahooCategoryMapping | null };

type Props = {
  /** グリッドの全行（表示・同カテゴリ判定に使う。編集は onRowChange / onRowsChange 経由） */
  rows: GridRow[];
  /** 対象行（グリッドのセル操作・行番号クリックで親が追跡する） */
  selectedIndex: number;
  /** 対象行1行の更新 */
  onRowChange: (rowIndex: number, next: GridRow) => void;
  /** 複数行の一括更新（同じカテゴリの行すべてに適用） */
  onRowsChange: (next: GridRow[]) => void;
};

/** /bulk-register 右側のカテゴリ読み込みパネル。
 * 対象行の「モール基本カテゴリID」を『📥 読み込み』ボタンの明示操作で読み込み（自動fetchしない）、
 * - 商品属性: 項目・単位を縦に並べ、値を入力するだけの状態にする（値は対象行の attributes へ即反映）
 * - Yahooカテゴリ: 変換候補（ID/名称/パス）を表示し「適用」で行へ（空欄のときだけ = 手入力優先）
 * - 同じカテゴリIDの行が複数あるときは、属性値・Yahoo候補を全行へまとめて適用できる
 * データ取得は products/new（ProductForm）・保存時自動補完と同一ソースを使う。 */
export function CategoryAssistPanel({ rows, selectedIndex, onRowChange, onRowsChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 直近に読み込んだカテゴリID とその結果（Yahoo候補・単位候補の表示に使う） */
  const [loaded, setLoaded] = useState<{ categoryId: string; info: LoadedCategory } | null>(null);
  const cacheRef = useRef(new Map<string, LoadedCategory>());

  const row = rows[selectedIndex] as GridRow | undefined;
  const categoryId = row?.mall_category_id.trim() ?? "";
  const sameCategoryOthers = row ? sameCategoryRowIndexes(rows, selectedIndex).length : 0;
  /** 読み込み済み情報が対象行のカテゴリIDと一致しているときだけ Yahoo 候補等を表示する */
  const current = loaded && loaded.categoryId === categoryId ? loaded.info : null;
  const attributes = row?.attributes ?? [];

  const load = async () => {
    if (!row || loading) return;
    if (categoryId === "") {
      setMessage("先に対象行の「モール基本カテゴリID」を入力してください");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      let info = cacheRef.current.get(categoryId);
      if (!info) {
        const supabase = createClient();
        info = {
          attrs: await fetchGenreAttributes(supabase, categoryId),
          yahoo: await fetchYahooCategoryMapping(supabase, categoryId),
        };
        cacheRef.current.set(categoryId, info);
      }
      setLoaded({ categoryId, info });
      if (info.attrs.length === 0 && !info.yahoo) {
        setMessage(`カテゴリID ${categoryId} の商品属性・Yahooカテゴリはマスタに見つかりませんでした`);
      } else {
        // 項目・単位を対象行へ展開（既に入力済みの値は item 単位で保持される）
        if (info.attrs.length > 0) onRowChange(selectedIndex, loadAttributesIntoRow(row, info.attrs));
        setMessage(
          `カテゴリID ${categoryId}: 商品属性 ${info.attrs.length} 件 / Yahoo候補 ${info.yahoo ? "あり" : "なし"}`,
        );
      }
    } catch (e) {
      setMessage("読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  const applyYahooToRow = () => {
    if (!row || !current?.yahoo) return;
    const result = applyYahooCandidate(row, current.yahoo);
    if (!result.appliedId && !result.appliedPath) {
      setMessage("YahooカテゴリID・パスは入力済みのため上書きしませんでした（空欄のときだけ適用します）");
      return;
    }
    onRowChange(selectedIndex, result.row);
    setMessage(
      `${selectedIndex + 1} 行目に ${[result.appliedId ? "YahooカテゴリID" : "", result.appliedPath ? "Yahooパス" : ""].filter(Boolean).join("・")} を適用しました`,
    );
  };

  const applyYahooToAll = () => {
    if (!current?.yahoo) return;
    const result = applyYahooToSameCategory(rows, selectedIndex, current.yahoo);
    if (result.appliedRows === 0) {
      setMessage("同じカテゴリIDの行はすべて入力済みのため、適用する行がありませんでした");
      return;
    }
    onRowsChange(result.rows);
    setMessage(`同じカテゴリID ${categoryId} の ${result.appliedRows} 行に Yahoo カテゴリを適用しました（空欄のみ）`);
  };

  const copyAttributesToAll = () => {
    if (!row) return;
    const result = copyAttributesToSameCategory(rows, selectedIndex);
    if (result.appliedRows === 0) {
      setMessage("コピー先（同じカテゴリIDの他の行）がありません");
      return;
    }
    onRowsChange(result.rows);
    setMessage(`商品属性の値を、同じカテゴリID ${categoryId} の他 ${result.appliedRows} 行へコピーしました`);
  };

  /** 読み込んだ属性定義から単位の候補ヒントを引く（ツールチップ表示用） */
  const unitHint = (item: string): string => {
    const def = current?.attrs.find((a) => a.item_name === item);
    if (!def) return "";
    return def.unit_choices ? `単位の候補: ${def.unit_choices}` : "";
  };

  return (
    <aside className="w-80 shrink-0 space-y-3 rounded border border-emerald-200 bg-white p-3 text-sm sticky top-4 max-h-[85vh] overflow-y-auto">
      <div>
        <h2 className="font-semibold text-emerald-800">📥 カテゴリ読み込みパネル</h2>
        <p className="mt-1 text-xs text-slate-500">
          モール基本カテゴリIDを入力した行のセルをクリック（または行番号をクリック）して対象行を選び、
          「読み込み」を押すと、商品属性の項目・単位と Yahoo カテゴリ候補がここに表示されます。
        </p>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 p-2 space-y-1">
        <div className="text-xs text-slate-500">対象行</div>
        {row ? (
          <div className="text-slate-800">
            <span className="font-semibold">{selectedIndex + 1} 行目</span>
            <span className="ml-1 text-xs text-slate-500">
              {row.product_name.trim() !== "" ? row.product_name : row.ne_code.trim() !== "" ? row.ne_code : "（未入力の行）"}
            </span>
          </div>
        ) : (
          <div className="text-slate-400">行がありません</div>
        )}
        <div className="text-xs text-slate-600">
          モール基本カテゴリID: {categoryId !== "" ? <span className="font-mono">{categoryId}</span> : <span className="text-slate-400">（未入力）</span>}
          {sameCategoryOthers > 0 && (
            <span className="ml-1 text-emerald-700">（同じIDの行が他に {sameCategoryOthers} 行）</span>
          )}
        </div>
        <Button onClick={load} disabled={loading || !row} variant="outline" className="w-full">
          {loading ? "読み込み中…" : "📥 読み込み（属性・Yahoo候補）"}
        </Button>
      </div>

      {message && <p className="text-xs text-blue-700">{message}</p>}

      {/* 商品属性: 読み込んだ項目・単位が並び、値を入力するだけ（対象行の保存データへ即反映） */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-600 border-b border-slate-200 pb-1">
          商品属性（値を入力するだけで {row ? selectedIndex + 1 : "-"} 行目に反映）
        </h3>
        {attributes.length === 0 ? (
          <p className="text-xs text-slate-400">
            未読み込みです。「読み込み」を押すと項目・単位が表示されます。
          </p>
        ) : (
          <div className="space-y-1.5">
            {attributes.map((a, i) => {
              const required = isRequiredAttribute(a.requirement);
              return (
                <div
                  key={`${a.item}-${i}`}
                  className={
                    "rounded border px-2 py-1.5 " +
                    (required ? "border-rose-200 bg-rose-50" : "border-slate-200")
                  }
                >
                  <div className="flex items-center gap-1 text-xs text-slate-700">
                    <span className="truncate" title={a.item}>{a.item}</span>
                    {required && (
                      <span className="shrink-0 text-[10px] font-bold text-rose-700 bg-rose-200 rounded px-1">
                        {a.requirement}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="text"
                      value={a.value}
                      placeholder="値"
                      onChange={(e) => row && onRowChange(selectedIndex, setRowAttribute(row, i, { value: e.target.value }))}
                      className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      value={a.unit}
                      placeholder="単位"
                      title={unitHint(a.item)}
                      onChange={(e) => row && onRowChange(selectedIndex, setRowAttribute(row, i, { unit: e.target.value }))}
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              );
            })}
            {sameCategoryOthers > 0 && (
              <Button
                variant="outline"
                className="w-full"
                onClick={copyAttributesToAll}
                title="この行の属性の値・単位を、同じモール基本カテゴリIDの他の行へコピーします（コピー元が空欄の項目は、コピー先の入力値を消しません）"
              >
                属性値を同カテゴリの他 {sameCategoryOthers} 行へコピー
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Yahoo カテゴリ候補: 適用は空欄のときだけ（手入力優先） */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-600 border-b border-slate-200 pb-1">
          Yahoo カテゴリ候補
        </h3>
        {!current ? (
          <p className="text-xs text-slate-400">
            未読み込みです。「読み込み」を押すと変換候補が表示されます。
          </p>
        ) : !current.yahoo ? (
          <p className="text-xs text-slate-500">
            カテゴリID {categoryId} に対応する Yahoo カテゴリ候補は見つかりませんでした（YahooカテゴリID・パスは手入力してください）。
          </p>
        ) : (
          <div className="rounded border border-rose-200 bg-rose-50 p-2 space-y-1 text-xs">
            <div>
              <span className="text-slate-500">YahooカテゴリID:</span>{" "}
              <span className="font-mono font-semibold">{current.yahoo.yahoo_category_id}</span>
            </div>
            {current.yahoo.yahoo_category_name && (
              <div>
                <span className="text-slate-500">名称:</span> {current.yahoo.yahoo_category_name}
              </div>
            )}
            {current.yahoo.yahoo_path && (
              <div>
                <span className="text-slate-500">パス:</span> {current.yahoo.yahoo_path}
              </div>
            )}
            {current.yahoo.confidence && (
              <div className="text-slate-400">マッピング確度: {current.yahoo.confidence}</div>
            )}
            <div className="flex gap-1 pt-1">
              <Button
                variant="outline"
                onClick={applyYahooToRow}
                title="対象行の YahooカテゴリID・Yahooストアカテゴリパスが空欄のときだけ入ります（手入力優先）"
              >
                この行に適用
              </Button>
              {sameCategoryOthers > 0 && (
                <Button
                  variant="outline"
                  onClick={applyYahooToAll}
                  title="同じモール基本カテゴリIDの行すべてに適用します（各行とも空欄のときだけ）"
                >
                  同カテゴリの全行に適用
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
