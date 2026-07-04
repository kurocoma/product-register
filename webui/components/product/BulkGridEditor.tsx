"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteProduct, upsertProduct } from "@/lib/product/repository";
import { saveGroupWithCleanup } from "@/lib/product/bulk-save";
import {
  BULK_GRID_COLUMNS,
  TEMPLATE_FILENAME,
  type GridColumnKey,
  type GridRow,
  applyFieldChange,
  buildProductsFromRows,
  buildTemplateCsv,
  columnGroups,
  emptyGridRow,
  expandSetRows,
  fillDown,
  isRowBlank,
  parseClipboardColumn,
  parseQuantities,
  parseTsv,
  validateGridRows,
} from "@/lib/product/grid-rows";
import { CategoryAssistPanel } from "@/components/product/CategoryAssistPanel";
import {
  fetchGenreAttributes,
  type GenreAttribute,
} from "@/lib/product/genre-attributes";
import {
  fetchYahooCategoryMapping,
  type YahooCategoryMapping,
} from "@/lib/product/category-mapping";
import { applyCategoryAutofill } from "@/lib/product/category-autofill";
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

/** 列グループ見出しの背景色（グループの切れ目が分かる程度の淡い色分け） */
const GROUP_COLORS: Record<string, string> = {
  基本情報: "bg-slate-200 text-slate-700",
  価格: "bg-amber-100 text-amber-800",
  配送: "bg-sky-100 text-sky-800",
  カテゴリ: "bg-emerald-100 text-emerald-800",
  商品説明: "bg-violet-100 text-violet-800",
  Yahoo: "bg-rose-100 text-rose-800",
  バリエーション: "bg-orange-100 text-orange-800",
};

/** モール基本カテゴリID → 推奨属性 / Yahooカテゴリ の取得結果（保存中は同一IDを1回だけ取得） */
type CategoryInfo = { attrs: GenreAttribute[]; yahoo: YahooCategoryMapping | null };

/** products/new（ProductForm）と同一ソース（fetchGenreAttributes / fetchYahooCategoryMapping）で
 * カテゴリ情報を取得する。マスタ未登録・取得失敗は「補完なし」として保存自体は続行する。 */
async function fetchCategoryInfo(
  supabase: ReturnType<typeof createClient>,
  categoryId: string,
  cache: Map<string, CategoryInfo>,
): Promise<CategoryInfo> {
  const id = categoryId.trim();
  if (!id) return { attrs: [], yahoo: null };
  const cached = cache.get(id);
  if (cached) return cached;
  const info: CategoryInfo = { attrs: [], yahoo: null };
  try {
    info.attrs = await fetchGenreAttributes(supabase, id);
  } catch {
    /* 属性マスタの取得失敗は補完スキップ（保存は続行） */
  }
  try {
    info.yahoo = await fetchYahooCategoryMapping(supabase, id);
  } catch {
    /* マッピング取得失敗も同様 */
  }
  cache.set(id, info);
  return info;
}

export function BulkGridEditor() {
  const [rows, setRows] = useState<RowState[]>(() => [newRow(), newRow(), newRow()]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState("");
  /** 長文セル（説明文HTML等）の拡大エディタで開いているセル。行は uid で追跡（行削除でズレない）。 */
  const [expandedCell, setExpandedCell] = useState<{ uid: number; key: GridColumnKey } | null>(null);
  /** カテゴリ読み込みパネルの対象行。セル操作・行番号クリックで追跡（uid = 行削除でズレない）。 */
  const [activeUid, setActiveUid] = useState<number | null>(null);
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
  const groups = useMemo(() => columnGroups(BULK_GRID_COLUMNS), []);

  /** カテゴリ読み込みパネルの対象行 index。未選択・削除済みなら先頭行。 */
  const activeRowIndex = useMemo(() => {
    const i = rows.findIndex((r) => r.uid === activeUid);
    return i >= 0 ? i : 0;
  }, [rows, activeUid]);

  /** 拡大エディタの対象行（削除済みなら null → パネルは自動で閉じる） */
  const expandedTarget = useMemo(() => {
    if (!expandedCell) return null;
    const rowIndex = rows.findIndex((r) => r.uid === expandedCell.uid);
    if (rowIndex < 0) return null;
    const col = BULK_GRID_COLUMNS.find((c) => c.key === expandedCell.key);
    if (!col) return null;
    return { rowIndex, col, value: rows[rowIndex].data[expandedCell.key] ?? "" };
  }, [expandedCell, rows]);

  /** テンプレートCSVのダウンロード（UTF-8 BOM付き = Excel でそのまま開ける）。
   * 見出しはグリッド列と同一（列定義 BULK_GRID_COLUMNS が単一源泉）。
   * 2〜3行目はバリエーションキー統合の入力例（単品+セット）、末尾は※説明行。 */
  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv(BULK_GRID_COLUMNS)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = TEMPLATE_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  };

  const editCell = (rowIndex: number, key: GridColumnKey, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, data: applyFieldChange(r.data, key, value), result: undefined } : r)),
    );
  };

  /** 1行の行データを差し替える（カテゴリ読み込みパネルの属性値入力・Yahoo適用から使う）。 */
  const updateRowData = (rowIndex: number, next: GridRow) => {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, data: next, result: undefined } : r)));
  };

  /** 複数行の行データをまとめて差し替える（フィルダウン・同カテゴリ一括適用から使う）。
   * 参照が変わった行だけ result をリセットする。 */
  const updateRowsData = (next: GridRow[]) => {
    setRows((prev) => prev.map((r, i) => (next[i] === r.data ? r : { ...r, data: next[i] ?? r.data, result: undefined })));
  };

  /** 列方向の貼り付け: values を rowIndex のセルから下方向へ展開する（不足行は自動追加）。 */
  const pasteColumnValues = (rowIndex: number, key: GridColumnKey, values: string[]) => {
    const label = BULK_GRID_COLUMNS.find((c) => c.key === key)?.label ?? key;
    setRows((prev) => {
      const next = [...prev];
      while (next.length < rowIndex + values.length) next.push(newRow());
      return next.map((r, i) => {
        const vi = i - rowIndex;
        if (vi < 0 || vi >= values.length) return r;
        return { ...r, data: applyFieldChange(r.data, key, values[vi]), result: undefined };
      });
    });
    setSummary(
      values.length === 1
        ? `「${label}」の ${rowIndex + 1} 行目に貼り付けました`
        : `「${label}」の ${rowIndex + 1}〜${rowIndex + values.length} 行目に ${values.length} 件を下方向へ貼り付けました`,
    );
  };

  /** グリッドのセルへの貼り付け（Excel の列コピー対応）。
   * - タブなし・改行あり（Excel の1列コピー）→ そのセルから下方向へ展開（セル内改行のクォートも解釈）
   * - タブあり（表全体のコピー）→ 従来の貼り付け取込と同じ行追加（parseTsv）
   * - 改行もタブもない単一値 → ブラウザ標準の貼り付けのまま */
  const onCellPaste = (e: React.ClipboardEvent, rowIndex: number, key: GridColumnKey) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    if (text.includes("\t")) {
      importTsv(text);
      return;
    }
    const values = parseClipboardColumn(text);
    if (values.length === 0) return;
    pasteColumnValues(rowIndex, key, values);
  };

  /** 下方向コピー（フィルダウン）: セルの値を最終行までコピーする（確認ダイアログ付き）。 */
  const fillDownFrom = (rowIndex: number, key: GridColumnKey) => {
    const label = BULK_GRID_COLUMNS.find((c) => c.key === key)?.label ?? key;
    const count = rows.length - 1 - rowIndex;
    if (count <= 0) {
      window.alert("コピー先の行がありません（最終行のセルです。先に「+ 行を追加」してください）。");
      return;
    }
    const ok = window.confirm(
      `「${label}」の ${rowIndex + 1} 行目の値を、下の ${count} 行（${rows.length} 行目まで）へコピーします。よろしいですか？`,
    );
    if (!ok) return;
    updateRowsData(fillDown(rows.map((r) => r.data), key, rowIndex));
    setSummary(`「${label}」を ${rowIndex + 2}〜${rows.length} 行目（${count} 行）へ下方向コピーしました`);
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
      setSummary("貼り付け内容から行を読み取れませんでした。Excel（テンプレート or データ入力シート）の行をコピーして貼り付けてください。");
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

  /** 一括保存。バリエーションキーが同じ行は buildProductsFromRows で1商品（variants[]）に統合し、
   * モール基本カテゴリIDから商品属性・Yahooカテゴリを自動補完（products/new と同一ソース・手入力優先）
   * してから upsert する。 */
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSummary("");
    const supabase = createClient();
    let ok = 0;
    let ng = 0;
    const current = rows;
    const results = new Map<number, { ok: boolean; message: string; savedId?: string }>();
    const categoryCache = new Map<string, CategoryInfo>();
    const built = buildProductsFromRows(current.map((r) => r.data));

    for (const b of built) {
      const members = b.rowIndexes.map((i) => current[i]).filter(Boolean);
      if (!b.input) {
        for (const i of b.rowIndexes) {
          const m = current[i];
          if (!m) continue;
          const errors = b.errors.get(i) ?? [];
          results.set(m.uid, { ok: false, message: `入力エラー: ${errors.join(" / ")}` });
        }
        ng++;
        continue;
      }
      try {
        // カテゴリ由来の自動補完（属性・Yahooカテゴリ。手入力があれば上書きしない）
        const info = await fetchCategoryInfo(supabase, b.input.mall_category_id, categoryCache);
        const { product, filled } = applyCategoryAutofill(b.input, info.attrs, info.yahoo);
        // 統合グループは既に保存済みの行があればその商品（primary）を更新する（重複登録しない）。
        // 行ごとに別々の savedId が混在する場合（例: 先に個別保存 → 後からキーを付けて再保存）は、
        // 統合先への保存成功後に吸収された旧フラット商品を削除する（孤児化＝一覧重複・NE CSV 二重出力の防止）。
        const { savedId, wasUpdate, cleanedIds, cleanupFailed } = await saveGroupWithCleanup(
          product,
          members.map((m) => m.savedId),
          {
            upsert: (p, id) => upsertProduct(supabase, p, id),
            remove: (id) => deleteProduct(supabase, id),
          },
        );
        const fills = [
          filled.attributes ? "商品属性" : "",
          filled.yahoo ? "Yahooカテゴリ" : "",
        ].filter(Boolean);
        const fillNote = fills.length > 0 ? `（${fills.join("・")}を自動補完）` : "";
        const cleanupNote =
          (cleanedIds.length > 0 ? `（統合により旧商品${cleanedIds.length}件を整理）` : "") +
          (cleanupFailed.length > 0
            ? `（旧商品${cleanupFailed.length}件の整理に失敗: ${cleanupFailed.map((f) => f.message).join(" / ")}。商品一覧から削除してください）`
            : "");
        const message =
          b.variationKey !== ""
            ? `${wasUpdate ? "統合更新" : "統合登録"}しました（${product.variants.length} SKU / 楽天管理番号 ${product.rakuten_manage_number}）${fillNote}${cleanupNote}`
            : `${wasUpdate ? "更新" : "登録"}しました${fillNote}${cleanupNote}`;
        for (const m of members) results.set(m.uid, { ok: true, message, savedId });
        ok++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        for (const m of members) results.set(m.uid, { ok: false, message });
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
    setSummary(`保存結果: 成功 ${ok} 商品 / 失敗 ${ng} 商品${ng > 0 ? "（失敗行の理由は右端の「状態」列を確認）" : ""}`);
    setSaving(false);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">一括登録（まとめて入力）</h1>
        <p className="mt-1 text-sm text-slate-600">
          Excel のデータ入力シートと同じ列構成（基本18列）に、商品説明文・Yahooカテゴリ等の拡張列とバリエーションキーを加えた
          {BULK_GRID_COLUMNS.length}列で、複数商品をまとめて登録できます。
          保存した商品は<Link href="/products" className="text-blue-600 hover:underline">商品一覧</Link>に表示され、
          モール（楽天 / Yahoo）への一括登録・一括反映は商品一覧で対象商品を選択して実行します。
        </p>
        <ul className="mt-2 text-xs text-slate-500 list-disc pl-5 space-y-0.5">
          <li>NEコードはメーカーコード・JAN・数量から自動生成されます（手修正も可能）。掲載商品名は商品名から自動補完されます。</li>
          <li>
            <span className="font-semibold">バリエーションキー</span>が同じ行は保存時に1商品へ統合され、
            楽天では同じ商品管理番号（メーカーコード-JAN下4桁）のSKU（バリエーション）として登録されます。
            NE側は従来どおり行（SKU）ごとに分かれたまま連携されます。
          </li>
          <li>
            カテゴリは<span className="font-semibold">モール基本カテゴリIDだけ入力すればOK</span>です。
            保存時に商品属性（項目・単位）と YahooカテゴリID/パスを自動補完します（商品編集画面と同じ仕組み。手入力があれば手入力を優先）。
          </li>
          <li>
            モール基本カテゴリID⚡を入力したら、右の<span className="font-semibold">カテゴリ読み込みパネル</span>の「📥 読み込み」で
            商品属性の項目・単位と Yahoo カテゴリ候補を先に表示できます（値を入力するだけで対象行に反映。対象行はセルまたは行番号のクリックで切替）。
          </li>
          <li>
            <span className="font-semibold">Excel の1列コピー（縦方向）</span>は、貼り付けたいセルに Ctrl+V するとそのセルから下方向へ展開されます
            （行が足りなければ自動追加。セル内改行を含む値も1セル=1値で取り込みます）。表全体のコピー（複数列）は従来どおり行として取り込みます。
          </li>
          <li>各セル右の「↓」で、そのセルの値を最終行まで<span className="font-semibold">下方向コピー</span>できます（コピー件数を確認してから実行）。</li>
          <li>単品行の「セット行」ボタンで、数量違いのセット商品行を自動展開できます（販売価格だけ入力すれば OK。バリエーションキーも引き継がれます）。</li>
          <li>Enter キーで下の行へ移動します（Excel と同じ操作感。最終行では行が自動追加されます）。</li>
          <li>「テンプレートDL」で列見出し＋入力例（バリエーション統合の2行デモ付き）入りの CSV を取得し、Excel で記入 → コピーして「貼り付け取込」できます。</li>
          <li>商品説明文などの長文列は、セルの「✎」を押すと下の拡大エディタで編集できます。</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={addRow}>+ 行を追加</Button>
        <Button variant="outline" onClick={downloadTemplate} title="グリッドと同じ列見出し＋入力例1行の CSV（Excel でそのまま開けます）">
          📄 テンプレートDL（CSV）
        </Button>
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
            Excel（ダウンロードしたテンプレート、または従来のデータ入力シート）で行を選択してコピーし、下の枠に貼り付けてください。
            列の並びはこのグリッドと同じです（従来どおり基本18列・バリエーションキー無しの27列だけの貼り付けも可）。
            見出し行・左端の空列・「※」で始まる説明行が含まれていても自動で読み飛ばします。NEコード・掲載商品名が空欄なら自動補完します。
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

      {/* 左: グリッド / 右: カテゴリ読み込みパネル（対象行の属性・Yahoo候補） */}
      <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0 bg-white rounded border border-slate-200 overflow-auto max-h-[70vh]">
        <table className="text-xs border-collapse">
          <thead>
            {/* 1段目: 列グループ見出し（基本情報/価格/配送/カテゴリ/商品説明/Yahoo）。縦スクロールしても固定。 */}
            <tr>
              <th rowSpan={2} className="px-2 py-2 text-left text-slate-500 sticky left-0 top-0 bg-slate-100 z-30">#</th>
              {groups.map((g) => (
                <th
                  key={g.name}
                  colSpan={g.span}
                  className={
                    "h-6 px-2 text-left text-[11px] font-semibold whitespace-nowrap sticky top-0 z-20 border-x border-white " +
                    (GROUP_COLORS[g.name] ?? "bg-slate-200 text-slate-700")
                  }
                >
                  {g.name}
                </th>
              ))}
              <th rowSpan={2} className="px-2 py-2 text-left whitespace-nowrap sticky top-0 z-20 bg-slate-100">操作</th>
              <th rowSpan={2} className="px-2 py-2 text-left whitespace-nowrap min-w-40 sticky top-0 z-20 bg-slate-100">状態</th>
            </tr>
            {/* 2段目: 列見出し（* = 必須、⚡ = 自動補完、✎ = 長文は拡大エディタで編集） */}
            <tr>
              {BULK_GRID_COLUMNS.map((col) => (
                <th key={col.key} className="px-1 py-2 text-left whitespace-nowrap sticky top-6 z-20 bg-slate-100" title={col.autoHint ?? ""}>
                  <span className={col.width + " inline-block px-1"}>
                    {col.label}
                    {col.required && <span className="text-red-500 ml-0.5">*</span>}
                    {col.autoHint && <span className="text-blue-500 ml-0.5" title={col.autoHint}>⚡</span>}
                    {col.long && <span className="text-violet-500 ml-0.5" title="長文列: セルをクリックすると下の拡大エディタで編集できます">✎</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIndex) => {
              const errors = validation.get(rowIndex) ?? [];
              const blank = isRowBlank(r.data);
              const isActiveRow = rowIndex === activeRowIndex;
              return (
                <tr key={r.uid} className="border-t border-slate-100 align-top">
                  <td
                    className={
                      "px-2 py-1 sticky left-0 z-10 cursor-pointer " +
                      (isActiveRow ? "bg-emerald-100 text-emerald-800 font-semibold" : "bg-white text-slate-400 hover:bg-emerald-50")
                    }
                    onClick={() => setActiveUid(r.uid)}
                    title="クリックすると右のカテゴリ読み込みパネルの対象行になります"
                  >
                    {rowIndex + 1}
                  </td>
                  {BULK_GRID_COLUMNS.map((col) => {
                    const value = r.data[col.key] ?? "";
                    const cellClass =
                      "w-full rounded border px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 " +
                      (!blank && errors.length > 0 ? "border-red-200 " : "border-slate-200 ") +
                      (col.key === "ne_code" || col.key === "jan_code" ? "font-mono " : "");
                    const isExpanded = expandedCell?.uid === r.uid && expandedCell?.key === col.key;
                    return (
                      <td key={col.key} className="px-1 py-1">
                        <div className={col.width + " flex items-center gap-0.5"}>
                          <div className="flex-1 min-w-0">
                            {col.long ? (
                              <button
                                type="button"
                                id={cellId(rowIndex, col.key)}
                                onClick={() => setExpandedCell(isExpanded ? null : { uid: r.uid, key: col.key })}
                                onFocus={() => setActiveUid(r.uid)}
                                onPaste={(e) => onCellPaste(e, rowIndex, col.key)}
                                title="クリックすると下の拡大エディタで編集できます（HTML可）。Excel の列コピーはこのセルに Ctrl+V で下方向へ貼り付けられます"
                                className={
                                  cellClass +
                                  "block truncate text-left bg-white hover:bg-violet-50 " +
                                  (isExpanded ? "ring-2 ring-violet-400 " : "") +
                                  (value.trim() === "" ? "text-slate-400" : "")
                                }
                              >
                                {value.trim() === "" ? "✎ 入力…" : `✎ (${value.length}) ${value}`}
                              </button>
                            ) : col.input === "select" ? (
                              <select
                                id={cellId(rowIndex, col.key)}
                                value={value}
                                onChange={(e) => editCell(rowIndex, col.key, e.target.value)}
                                onKeyDown={(e) => onCellKeyDown(e, rowIndex, col.key)}
                                onFocus={() => setActiveUid(r.uid)}
                                onPaste={(e) => onCellPaste(e, rowIndex, col.key)}
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
                                onFocus={() => setActiveUid(r.uid)}
                                onPaste={(e) => onCellPaste(e, rowIndex, col.key)}
                                className={cellClass + (col.input === "number" ? "text-right" : "")}
                              />
                            )}
                          </div>
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => fillDownFrom(rowIndex, col.key)}
                            title={`「${col.label}」のこの値を最終行まで下方向コピーします（コピー件数を確認してから実行）`}
                            className="shrink-0 rounded px-0.5 text-[10px] leading-4 text-slate-300 hover:text-blue-700 hover:bg-blue-100"
                          >
                            ↓
                          </button>
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

      <CategoryAssistPanel
        rows={rows.map((row) => row.data)}
        selectedIndex={activeRowIndex}
        onRowChange={updateRowData}
        onRowsChange={updateRowsData}
      />
      </div>

      {/* 長文列（説明文HTML等）の拡大エディタ。セル内編集の苦痛を避け、行の ✎ セルをクリックで開く。 */}
      {expandedTarget && expandedCell && (
        <div className="rounded border border-violet-300 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">
              ✎ {expandedTarget.rowIndex + 1} 行目「{expandedTarget.col.label}」
              <span className="ml-2 font-normal text-xs text-slate-500">
                HTML可 / 現在 {expandedTarget.value.length} 文字（入力はそのまま行に反映されます）
              </span>
            </div>
            <Button variant="ghost" onClick={() => setExpandedCell(null)}>閉じる</Button>
          </div>
          <textarea
            autoFocus
            value={expandedTarget.value}
            onChange={(e) => editCell(expandedTarget.rowIndex, expandedCell.key, e.target.value)}
            rows={8}
            placeholder="長文（商品説明文の HTML 等）をここで編集します"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </div>
      )}
    </div>
  );
}
