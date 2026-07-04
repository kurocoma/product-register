import type { GridRow, GridRowAttribute } from "./grid-rows";
import { genreAttributesToInputs, type GenreAttribute } from "./genre-attributes";
import { mergeGenreAttributes } from "./category-autofill";
import type { YahooCategoryMapping } from "./category-mapping";

/** カテゴリ読み込みパネル（/bulk-register 右側）の純関数層。
 *
 * データ取得は products/new（ProductForm）と同一ソース（fetchGenreAttributes /
 * fetchYahooCategoryMapping）を CategoryAssistPanel が「読み込み」ボタン押下時にだけ行い、
 * 取得結果を行へ反映する処理はすべてここの純関数が担う（ユニットテスト対象）。
 *
 * 規則:
 * - 属性の項目・単位は読み込みで行（GridRow.attributes）へ展開し、値だけ入力すれば良い状態にする。
 *   既に入力済みの値は item 単位で保持する（マージ規則は ProductForm・保存時自動補完と
 *   共有の mergeGenreAttributes = 単一実装）。
 * - Yahoo カテゴリ候補の適用は「空欄のときだけ」（手入力優先の既存規則を維持）。
 */

/** 読み込んだ推奨属性（項目・単位）を行へ展開する。
 * 既存の入力値（value/unit）は item 単位で保持する（再読み込みで消えない）。
 * attrs が空（マスタ未登録）のときは行を変えない。 */
export function loadAttributesIntoRow(row: GridRow, attrs: GenreAttribute[]): GridRow {
  if (attrs.length === 0) return row;
  return { ...row, attributes: mergeGenreAttributes(row.attributes ?? [], genreAttributesToInputs(attrs)) };
}

/** パネルの値/単位入力を行の attributes へ反映する（index は attributes 配列の位置）。
 * 範囲外 index は無視して行をそのまま返す。row は変更しない（イミュータブル）。 */
export function setRowAttribute(
  row: GridRow,
  index: number,
  patch: { value?: string; unit?: string },
): GridRow {
  const attrs = row.attributes ?? [];
  if (index < 0 || index >= attrs.length) return row;
  const next = attrs.map((a, i) =>
    i === index ? { ...a, value: patch.value ?? a.value, unit: patch.unit ?? a.unit } : a,
  );
  return { ...row, attributes: next };
}

/** Yahoo カテゴリ候補を行へ適用する。空欄の項目だけ埋める（手入力優先）。
 * 何が適用されたかを返す（両方 false = 既入力のため何もしなかった）。 */
export function applyYahooCandidate(
  row: GridRow,
  candidate: YahooCategoryMapping,
): { row: GridRow; appliedId: boolean; appliedPath: boolean } {
  const appliedId = row.yahoo_category_id.trim() === "" && candidate.yahoo_category_id.trim() !== "";
  const appliedPath = row.yahoo_path.trim() === "" && candidate.yahoo_path.trim() !== "";
  if (!appliedId && !appliedPath) return { row, appliedId, appliedPath };
  return {
    row: {
      ...row,
      yahoo_category_id: appliedId ? candidate.yahoo_category_id : row.yahoo_category_id,
      yahoo_path: appliedPath ? candidate.yahoo_path : row.yahoo_path,
    },
    appliedId,
    appliedPath,
  };
}

/** fromIndex 行と同じモール基本カテゴリID（trim 比較・空は対象外）を持つ他の行の index 一覧。 */
export function sameCategoryRowIndexes(rows: GridRow[], fromIndex: number): number[] {
  const source = rows[fromIndex];
  const id = source?.mall_category_id.trim() ?? "";
  if (id === "") return [];
  return rows
    .map((row, i) => ({ row, i }))
    .filter(({ row, i }) => i !== fromIndex && row.mall_category_id.trim() === id)
    .map(({ i }) => i);
}

/** 属性1件のコピー規則: コピー元の値が入っていれば上書き、空ならコピー先の既存値を保持する。 */
function mergeAttributeValues(
  target: GridRowAttribute[] | undefined,
  source: GridRowAttribute[],
): GridRowAttribute[] {
  const byItem = new Map((target ?? []).map((a) => [a.item, a]));
  return source.map((s) => {
    const t = byItem.get(s.item);
    return {
      item: s.item,
      value: s.value.trim() !== "" ? s.value : t?.value ?? "",
      unit: s.unit.trim() !== "" ? s.unit : t?.unit ?? "",
      requirement: s.requirement,
    };
  });
}

/** fromIndex 行の商品属性（項目・値・単位）を、同じカテゴリIDの行すべてへコピーする。
 * 複数行を同じカテゴリでまとめて登録するとき、1行分入力すれば残りの行に展開できる（A3）。
 * コピー元の値が空の項目は、コピー先で入力済みの値を消さない。 */
export function copyAttributesToSameCategory(
  rows: GridRow[],
  fromIndex: number,
): { rows: GridRow[]; appliedRows: number } {
  const source = rows[fromIndex];
  const attrs = source?.attributes ?? [];
  const targets = new Set(sameCategoryRowIndexes(rows, fromIndex));
  if (attrs.length === 0 || targets.size === 0) return { rows, appliedRows: 0 };
  return {
    rows: rows.map((row, i) =>
      targets.has(i) ? { ...row, attributes: mergeAttributeValues(row.attributes, attrs) } : row,
    ),
    appliedRows: targets.size,
  };
}

/** Yahoo カテゴリ候補を、同じカテゴリIDの行すべて（fromIndex 行を含む）へ適用する。
 * 各行とも空欄の項目だけ埋める（手入力優先）。実際に埋まった行数を返す。 */
export function applyYahooToSameCategory(
  rows: GridRow[],
  fromIndex: number,
  candidate: YahooCategoryMapping,
): { rows: GridRow[]; appliedRows: number } {
  const targets = new Set([fromIndex, ...sameCategoryRowIndexes(rows, fromIndex)]);
  let appliedRows = 0;
  const next = rows.map((row, i) => {
    if (!targets.has(i)) return row;
    const result = applyYahooCandidate(row, candidate);
    if (result.appliedId || result.appliedPath) appliedRows++;
    return result.row;
  });
  return { rows: appliedRows > 0 ? next : rows, appliedRows };
}
