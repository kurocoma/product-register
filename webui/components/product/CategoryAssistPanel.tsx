"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { flatAttributesOf, type GridRow } from "@/lib/product/grid-rows";
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
  applyYahooMappingsToRows,
  attributesToColumns,
  sameCategoryRowIndexes,
} from "@/lib/product/category-assist";
import { Button } from "@/components/ui/button";

/** カテゴリID 1件分の読み込み結果（読み込みボタン押下時にだけ取得。同一IDは再取得しない） */
type LoadedCategory = { attrs: GenreAttribute[]; yahoo: YahooCategoryMapping | null };

type Props = {
  /** グリッドの全行（表示・同カテゴリ判定に使う。編集は onRowChange / onRowsChange 経由） */
  rows: GridRow[];
  /** rows と同じ並びの行 uid 一覧（読み込み結果を同じカテゴリIDの行へも uid 引きで書き戻すため） */
  rowUids: number[];
  /** 対象行の index（グリッドのセル操作・行番号クリックで親が追跡する。表示・同カテゴリ判定用） */
  selectedIndex: number;
  /** 対象行の uid（行の追加・削除で index がずれても変わらない恒久ID。onRowChange の行指定用） */
  selectedUid: number;
  /** 対象行1行の更新。行は uid で指定する（fetch 中に行が削除・繰り上がりしても index ずれで
   * 別の行に書き込まない。対象行自体が削除済みなら親側で無害に何もしない）。
   * fetch 完了後の書き戻しなど非同期の反映は必ず関数型（現在の行 → 次の行）で
   * 渡すこと（親が最新の行にマージするため、fetch 中のグリッド編集が巻き戻らない）。 */
  onRowChange: (uid: number, next: GridRow | ((current: GridRow) => GridRow)) => void;
};

/** /bulk-register 右側のカテゴリ読み込みパネル。
 * 対象行の「モール基本カテゴリID」を『📥 読み込み』ボタンの明示操作で読み込み（自動fetchしない）、
 * 1クリックで以下を対象行＋同じカテゴリIDの行へまとめて反映する（統合フロー）:
 * - 商品属性: 項目・単位をグリッドの商品属性列（attribute_item_N / attribute_unit_N）へ展開する
 *   （attributesToColumns。必須優先で先頭5件・推奨単位プリフィル・入力済みの値は item 単位で保持）。
 *   値はグリッドの行内で入力する（パネルでは入力しない）。
 * - Yahooカテゴリ: 変換候補（ID/パス）を空欄の行へ自動適用する（手入力優先。規則はカテゴリ列
 *   グループ見出しの「YahooカテゴリIDをコピー」と同一 = applyYahooMappingsToRows / applyYahooCandidate）。
 *   候補（ID/名称/パス/確度）は読み取り専用でパネルに表示する。
 * データ取得は products/new（ProductForm）・保存時自動補完と同一ソースを使う。 */
export function CategoryAssistPanel({ rows, rowUids, selectedIndex, selectedUid, onRowChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 直近に読み込んだカテゴリID とその結果（Yahoo候補・必須バッジ・単位候補の表示に使う） */
  const [loaded, setLoaded] = useState<{ categoryId: string; info: LoadedCategory } | null>(null);
  const cacheRef = useRef(new Map<string, LoadedCategory>());

  const row = rows[selectedIndex] as GridRow | undefined;
  const categoryId = row?.mall_category_id.trim() ?? "";
  const sameCategoryOthers = row ? sameCategoryRowIndexes(rows, selectedIndex).length : 0;
  /** 読み込み済み情報が対象行のカテゴリIDと一致しているときだけ Yahoo 候補等を表示する */
  const current = loaded && loaded.categoryId === categoryId ? loaded.info : null;
  /** 対象行の商品属性列に展開済みの項目（グリッドのフラット5枠から表示。値の入力は行内） */
  const flatAttrs = row ? flatAttributesOf(row) : [];
  /** 6件目以降で切り捨てた属性の件数（編集画面で入力する案内用） */
  const truncated = current ? Math.max(0, current.attrs.length - 5) : 0;

  const load = async () => {
    if (!row || loading) return;
    if (categoryId === "") {
      setMessage("先に対象行の「モール基本カテゴリID」を入力してください");
      return;
    }
    // クリック時点の対象行＋同じカテゴリIDの行を uid で捕捉する（fetch 中に行が削除・
    // 繰り上がりしても正しい行へ届き、削除済みの行へは何も起きない）。
    const sameCategoryIndexes = sameCategoryRowIndexes(rows, selectedIndex);
    const targetIndexes = [selectedIndex, ...sameCategoryIndexes];
    const targetUids = [selectedUid, ...sameCategoryIndexes.map((i) => rowUids[i])].filter(
      (uid): uid is number => uid !== undefined,
    );
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
        const attrs = info.attrs;
        const mapping = info.yahoo;
        // Yahoo 適用の件数はクリック時のスナップショットで算出する（適用そのものは下の uid 引き）。
        // 空欄のみ適用・手入力優先の規則は、ヘッダの「YahooカテゴリIDをコピー」と同一実装
        // （applyYahooMappingsToRows → applyYahooCandidate）を再利用する（二重実装しない）。
        let applied = 0;
        let skipped = 0;
        if (mapping) {
          const counted = applyYahooMappingsToRows(
            targetIndexes.map((i) => rows[i]).filter(Boolean),
            new Map([[categoryId, mapping]]),
          );
          applied = counted.applied;
          skipped = counted.skipped;
        }
        // 属性の項目・単位の展開と Yahoo 自動適用を1回の関数型更新でまとめて反映する
        // （「最新の行」へマージ = fetch 中のグリッド編集が巻き戻らない。マスタ未登録側はスキップ）。
        for (const uid of targetUids) {
          onRowChange(uid, (currentRow) => {
            const withAttrs =
              attrs.length > 0
                ? { ...currentRow, ...attributesToColumns(attrs, currentRow).columns }
                : currentRow;
            return mapping ? applyYahooCandidate(withAttrs, mapping).row : withAttrs;
          });
        }
        const cut = Math.max(0, attrs.length - 5);
        const attrPart =
          attrs.length > 0
            ? `商品属性${attrs.length}件を展開` +
              (cut > 0 ? `（6件目以降の${cut}件は保存後に編集画面で入力）` : "")
            : "商品属性はマスタに見つかりませんでした";
        const yahooPart = mapping
          ? `YahooカテゴリID ${mapping.yahoo_category_id} を${applied}行に適用（${skipped}行は入力済みのためスキップ）`
          : "Yahooカテゴリ候補なし（YahooカテゴリID・パスは手入力してください）";
        setMessage(`カテゴリID ${categoryId}: ${attrPart}／${yahooPart}`);
      }
    } catch (e) {
      setMessage("読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  /** 読み込んだ属性定義から単位の候補一覧を引く（グリッドの単位列へ入力するときの参考表示用）。
   * マスタの unit_choices はパイプ区切り（例: 分|時間）。一部データの / 区切りも許容する。 */
  const unitChoicesOf = (item: string): string[] => {
    const def = current?.attrs.find((a) => a.item_name === item);
    if (!def?.unit_choices) return [];
    return def.unit_choices
      .split(/[|/]/)
      .map((u) => u.trim())
      .filter((u) => u !== "");
  };

  return (
    <aside className="w-80 shrink-0 space-y-3 rounded border border-emerald-200 bg-white p-3 text-sm sticky top-4 max-h-[85vh] overflow-y-auto">
      <div>
        <h2 className="font-semibold text-emerald-800">📥 カテゴリ読み込みパネル</h2>
        <p className="mt-1 text-xs text-slate-500">
          モール基本カテゴリIDを入力した行のセルをクリック（または行番号をクリック）して対象行を選び、
          「読み込み」を押すと、対象行と同じカテゴリIDの行へまとめて
          ①商品属性の項目・単位がグリッド右側の商品属性列に入り、
          ②YahooカテゴリID・パスが空欄の行へ自動で入ります（手入力があれば上書きしません）。
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
            <span className="ml-1 text-emerald-700">（同じIDの行が他に {sameCategoryOthers} 行 → まとめて展開）</span>
          )}
        </div>
        <Button onClick={load} disabled={loading || !row} variant="outline" className="w-full">
          {loading ? "読み込み中…" : "📥 読み込み（属性・Yahoo候補）→ 行へ自動適用"}
        </Button>
      </div>

      {message && <p className="text-xs text-blue-700">{message}</p>}

      {/* 商品属性: 項目・単位はグリッドの商品属性列へ展開済み。値の入力は行内で行う（ここでは入力しない） */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-600 border-b border-slate-200 pb-1">
          商品属性（{row ? `${selectedIndex + 1} 行目` : "-"} の展開状況）
        </h3>
        {flatAttrs.length === 0 ? (
          <p className="text-xs text-slate-400">
            未読み込みです。「読み込み」を押すと項目・単位が表示されます。
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
              属性はグリッド右側の商品属性列（項目・単位）に展開しました。値は行内で入力してください
              {truncated > 0 && <>（6件目以降の属性: {truncated}件は編集画面で入力）</>}。
            </p>
            {flatAttrs.map((a, i) => {
              const def = current?.attrs.find((d) => d.item_name === a.item);
              const required = def ? isRequiredAttribute(def.requirement) : false;
              const unitChoices = unitChoicesOf(a.item);
              return (
                <div
                  key={`${a.item}-${i}`}
                  className={
                    "rounded border px-2 py-1.5 " +
                    (required ? "border-rose-200 bg-rose-50" : "border-slate-200")
                  }
                >
                  <div className="flex items-center gap-1 text-xs text-slate-700">
                    <span className="shrink-0 text-slate-400">{i + 1}.</span>
                    <span className="truncate" title={a.item}>{a.item}</span>
                    {required && (
                      <span className="shrink-0 text-[10px] font-bold text-rose-700 bg-rose-200 rounded px-1">
                        {def!.requirement}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    値: {a.value.trim() !== "" ? a.value : "（行内で入力）"} / 単位: {a.unit.trim() !== "" ? a.unit : "（なし）"}
                    {unitChoices.length > 0 && <>（単位の候補: {unitChoices.join(" / ")}）</>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Yahoo カテゴリ候補: 読み込み時に空欄の行へ自動適用済み。ここは読み取り専用の確認表示 */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-600 border-b border-slate-200 pb-1">
          Yahoo カテゴリ候補
        </h3>
        {!current ? (
          <p className="text-xs text-slate-400">
            未読み込みです。「読み込み」を押すと変換候補が空欄の行へ自動で入り、内容がここに表示されます。
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
            <p className="pt-1 text-emerald-800">
              読み込み時に、同じカテゴリIDの行の空欄へ自動適用済みです（手入力があれば上書きしません。
              修正はグリッドの YahooカテゴリID / Yahooストアカテゴリパス列で行えます）。
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
