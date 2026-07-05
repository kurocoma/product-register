import { flatAttributesOf, type GridRow, type GridRowAttribute } from "./grid-rows";
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

/** attributesToColumns の結果。columns を行へスプレッドすれば商品属性のグリッド列が埋まる。 */
export type AttributeColumns = {
  /** attribute_item_1〜attribute_unit_5 の15フィールド（attrs 空のときは空オブジェクト = 行を変えない） */
  columns: Partial<GridRow>;
  /** 6件目以降で切り捨てた属性の件数（「n件は編集画面で入力」の案内用） */
  truncated: number;
};

/** 読み込んだ推奨属性（項目・単位）をグリッドの商品属性列（フラット5枠）へ展開する純関数。
 * - 必須系（requirement に「必須」を含む: 必須/いずれか必須）優先 → 同順位は API 順で先頭5件を割当
 * - 単位は楽天推奨単位をプリフィルする
 * - currentRow に同名 item の入力が既にあれば、その値・単位を保持する（手入力優先。
 *   フラット列 → row.attributes の順で参照し、枠位置が変わっても item 単位で追従）
 * - 6件目以降は切り捨て、truncated に件数を返す（保存時の自動補完で attributes[] には全件入るため、
 *   値は編集画面で入力できる）
 * - attrs が空（マスタ未登録）のときは columns 空 = 行を変えない（既存規則と同じ） */
export function attributesToColumns(attrs: GenreAttribute[], currentRow: GridRow): AttributeColumns {
  if (attrs.length === 0) return { columns: {}, truncated: 0 };

  const isRequired = (a: GenreAttribute) => (a.requirement ?? "").includes("必須");
  const ordered = [...attrs.filter(isRequired), ...attrs.filter((a) => !isRequired(a))];
  const top = ordered.slice(0, 5);

  // 既存入力の item → 値・単位（フラット列を優先し、旧形式 row.attributes をフォールバック）
  const existing = new Map<string, { value: string; unit: string }>();
  for (const a of currentRow.attributes ?? []) {
    const item = (a.item ?? "").trim();
    if (item !== "") existing.set(item, { value: a.value ?? "", unit: a.unit ?? "" });
  }
  for (const a of flatAttributesOf(currentRow)) existing.set(a.item, { value: a.value, unit: a.unit });

  const columns: Record<string, string> = {};
  for (let n = 1; n <= 5; n++) {
    const attr = top[n - 1];
    if (!attr) {
      // 使わない枠は空にする（前カテゴリの残骸を残さない）
      columns[`attribute_item_${n}`] = "";
      columns[`attribute_value_${n}`] = "";
      columns[`attribute_unit_${n}`] = "";
      continue;
    }
    const prev = existing.get(attr.item_name);
    columns[`attribute_item_${n}`] = attr.item_name;
    columns[`attribute_value_${n}`] = prev?.value ?? "";
    columns[`attribute_unit_${n}`] = prev?.unit.trim() ? prev.unit : attr.recommended_unit || "";
  }
  return { columns: columns as Partial<GridRow>, truncated: Math.max(0, attrs.length - 5) };
}

/** 全行のモール基本カテゴリIDのユニーク集合（trim・空欄除外・出現順）。
 * 「YahooカテゴリIDをコピー」が fetch すべき ID の一覧に使う（同じIDは1回だけ解決）。 */
export function collectMallCategoryIds(rows: GridRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const id = row.mall_category_id.trim();
    if (id !== "" && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 解決済みの Yahoo カテゴリ候補（カテゴリID → 候補 or null）を全行へ適用する純関数。
 * 各行とも「空欄の項目だけ」埋める（手入力優先 = applyYahooCandidate と同一規則）。
 * - applied: ID/パスのどちらかが埋まった行数（「n行に適用」）
 * - skipped: 候補はあるが両方入力済みで何もしなかった行数（「m行は入力済みのためスキップ」）
 * - unresolved: 候補が見つからなかった行数（カテゴリID未入力の行はどれにも数えない） */
export function applyYahooMappingsToRows(
  rows: GridRow[],
  mappings: ReadonlyMap<string, YahooCategoryMapping | null>,
): { rows: GridRow[]; applied: number; skipped: number; unresolved: number } {
  let applied = 0;
  let skipped = 0;
  let unresolved = 0;
  const next = rows.map((row) => {
    const id = row.mall_category_id.trim();
    if (id === "") return row;
    const mapping = mappings.get(id);
    if (!mapping) {
      unresolved++;
      return row;
    }
    const result = applyYahooCandidate(row, mapping);
    if (result.appliedId || result.appliedPath) {
      applied++;
      return result.row;
    }
    skipped++;
    return row;
  });
  return { rows: applied > 0 ? next : rows, applied, skipped, unresolved };
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
