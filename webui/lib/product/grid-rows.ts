import Papa from "papaparse";
import { ProductInputSchema, type ProductInput } from "./schema";

/** 一括登録グリッド（Excel「データ入力シート」B〜S列相当の18列）の純関数層。
 *
 * 実テンプレート(バヤリース 商品登録用テンプレート「データ入力シート」3行目見出し)の列順:
 * NEコード / JANコード / メーカーコード / 単品orセット商品 / 数量 / 商品名 / 掲載商品名 /
 * 消費税率 / 原価 / 販売価格 / 送料区分 / 作成した画像数 / 配送方法セット / 納期管理番号 /
 * モール基本カテゴリID / 店舗内カテゴリ1 / キャッチコピーPC / キャッチコピー(Yahoo)
 *
 * 省力化の設計（Excel 実データ a009-4916-1/6/24/48 のパターン分析より）:
 * - NEコード = `メーカーコード-JAN下4桁-数量` の規約 → 自動生成（手修正で上書き可）
 * - 掲載商品名 = 商品名と同一のことがほとんど → 商品名から自動補完（手修正で追従停止）
 * - セット行 = 単品行の複製＋（数量・価格・NEコード末尾）だけが違う → expandSetRows で自動展開
 * - 税率10 / 送料区分「送料別」/ 配送方法セット4 / 納期管理番号1 / 数量1 は既定値プリセット
 * - Excel からのコピー（TSV）を parseTsv で行に変換 → 既存シートからの移行はコピペのみ
 */

/** グリッド1行。入力途中の値を保持するため全て文字列で持つ（数値変換は保存時）。 */
export type GridRow = {
  ne_code: string;
  jan_code: string;
  maker_code: string;
  product_type: string; // 単品 | セット商品
  quantity: string;
  product_name: string;
  display_name: string;
  tax_rate: string; // 8 | 10
  cost_price: string;
  selling_price: string;
  shipping_type: string; // 送料別 | 送料無料
  image_count: string;
  delivery_method: string;
  lead_time: string;
  mall_category_id: string;
  store_category: string;
  catch_copy_pc: string;
  catch_copy_yahoo: string;
  /** 自動補完の管理フラグ。ユーザーが手入力したら false になり追従を止める。 */
  auto: { ne_code: boolean; display_name: boolean };
};

export type GridColumnKey = Exclude<keyof GridRow, "auto">;

export type GridColumn = {
  key: GridColumnKey;
  label: string;
  /** 必須入力（保存に必要）なら true。見出しに * を付ける。 */
  required?: boolean;
  /** セル入力の種類。select は options から選択。 */
  input: "text" | "number" | "select";
  options?: string[];
  /** Tailwind 幅クラス（グリッドの列幅） */
  width: string;
  /** 自動補完される列の説明（ツールチップ表示用） */
  autoHint?: string;
};

/** データ入力シートの列順そのまま（18列）。 */
export const GRID_COLUMNS: GridColumn[] = [
  { key: "ne_code", label: "NEコード", required: true, input: "text", width: "w-32", autoHint: "メーカーコード-JAN下4桁-数量 から自動生成（手修正可）" },
  { key: "jan_code", label: "JANコード", required: true, input: "text", width: "w-36" },
  { key: "maker_code", label: "メーカーコード", required: true, input: "text", width: "w-24" },
  { key: "product_type", label: "単品orセット商品", required: true, input: "select", options: ["単品", "セット商品"], width: "w-28" },
  { key: "quantity", label: "数量", required: true, input: "number", width: "w-16" },
  { key: "product_name", label: "商品名", required: true, input: "text", width: "w-64" },
  { key: "display_name", label: "掲載商品名", input: "text", width: "w-64", autoHint: "商品名から自動補完（手修正可）" },
  { key: "tax_rate", label: "消費税率", required: true, input: "select", options: ["8", "10"], width: "w-16" },
  { key: "cost_price", label: "原価", input: "number", width: "w-20" },
  { key: "selling_price", label: "販売価格", required: true, input: "number", width: "w-24" },
  { key: "shipping_type", label: "送料区分", input: "select", options: ["送料別", "送料無料"], width: "w-24" },
  { key: "image_count", label: "作成した画像数", input: "number", width: "w-16" },
  { key: "delivery_method", label: "配送方法セット", input: "number", width: "w-16" },
  { key: "lead_time", label: "納期管理番号", input: "number", width: "w-16" },
  { key: "mall_category_id", label: "モール基本カテゴリID", input: "text", width: "w-28" },
  { key: "store_category", label: "店舗内カテゴリ1", input: "text", width: "w-40" },
  { key: "catch_copy_pc", label: "キャッチコピーPC", input: "text", width: "w-56" },
  { key: "catch_copy_yahoo", label: "キャッチコピー(Yahoo)", input: "text", width: "w-56" },
];

const COLUMN_KEYS: GridColumnKey[] = GRID_COLUMNS.map((c) => c.key);

/** 新規行。よく使う値（税率10/送料別/配送方法4/納期1/数量1/画像数1）を既定値でプリセット。 */
export function emptyGridRow(): GridRow {
  return {
    ne_code: "",
    jan_code: "",
    maker_code: "",
    product_type: "単品",
    quantity: "1",
    product_name: "",
    display_name: "",
    tax_rate: "10",
    cost_price: "",
    selling_price: "",
    shipping_type: "送料別",
    image_count: "1",
    delivery_method: "4",
    lead_time: "1",
    mall_category_id: "",
    store_category: "",
    catch_copy_pc: "",
    catch_copy_yahoo: "",
    auto: { ne_code: true, display_name: true },
  };
}

/** 既定値のまま何も入力されていない行か（保存・検証の対象外にする）。 */
export function isRowBlank(row: GridRow): boolean {
  const base = emptyGridRow();
  return COLUMN_KEYS.every((k) => row[k].trim() === "" || row[k] === base[k]);
}

/** カンマ・空白を除いて数値化。数値でなければ NaN。 */
function toNumber(s: string): number {
  const t = s.replace(/[,\s]/g, "");
  if (t === "") return NaN;
  return Number(t);
}

function isPosInt(s: string): boolean {
  const n = toNumber(s);
  return Number.isInteger(n) && n >= 1;
}

function isNonNegInt(s: string): boolean {
  const n = toNumber(s);
  return Number.isInteger(n) && n >= 0;
}

/** NEコード規約 `メーカーコード-JAN下4桁-数量` による自動生成。
 * JAN13桁が確定し maker と数量が揃うまでは空を返す（中途半端な値を作らない）。 */
export function suggestNeCode(row: Pick<GridRow, "maker_code" | "jan_code" | "quantity">): string {
  const maker = row.maker_code.trim();
  const jan = row.jan_code.trim();
  if (!maker || !/^\d{13}$/.test(jan) || !isPosInt(row.quantity)) return "";
  return `${maker}-${jan.slice(-4)}-${toNumber(row.quantity)}`;
}

/** セル編集を1回適用し、自動補完（NEコード・掲載商品名）を連動させる。
 * - ne_code / display_name を手入力 → 以後自動追従を止める。空に戻すと追従再開。
 * - maker_code / jan_code / quantity の変更 → auto中の ne_code を再生成。
 * - product_name の変更 → auto中の display_name に転写。 */
export function applyFieldChange(row: GridRow, key: GridColumnKey, value: string): GridRow {
  const next: GridRow = { ...row, auto: { ...row.auto }, [key]: value };

  if (key === "ne_code") {
    next.auto.ne_code = value.trim() === "";
  }
  if (key === "display_name") {
    next.auto.display_name = value.trim() === "";
  }

  if (next.auto.ne_code && (key === "ne_code" || key === "maker_code" || key === "jan_code" || key === "quantity")) {
    const s = suggestNeCode(next);
    if (s) next.ne_code = s;
    else if (key === "ne_code") next.ne_code = "";
  }
  if (next.auto.display_name && (key === "product_name" || key === "display_name")) {
    next.display_name = key === "product_name" ? value : next.product_name;
  }
  return next;
}

/** 空欄の自動補完をまとめて適用（TSV取込直後などに使う）。 */
export function autoFillRow(row: GridRow): GridRow {
  const next: GridRow = { ...row, auto: { ...row.auto } };
  if (next.ne_code.trim() === "") {
    next.auto.ne_code = true;
    const s = suggestNeCode(next);
    if (s) next.ne_code = s;
  }
  if (next.display_name.trim() === "") {
    next.auto.display_name = true;
    next.display_name = next.product_name;
  }
  return next;
}

/** 1行分の検証。エラーメッセージ（日本語）の配列を返す。空配列なら保存可能。 */
export function validateGridRow(row: GridRow): string[] {
  const errors: string[] = [];
  if (row.ne_code.trim() === "") errors.push("NEコードが未入力です（メーカーコード・JAN・数量が揃うと自動生成されます）");
  if (!/^\d{13}$/.test(row.jan_code.trim())) errors.push("JANコードは13桁の数字で入力してください");
  if (row.maker_code.trim() === "") errors.push("メーカーコードが未入力です");
  if (row.product_type !== "単品" && row.product_type !== "セット商品") errors.push("単品orセット商品は「単品」または「セット商品」を選択してください");
  if (!isPosInt(row.quantity)) errors.push("数量は1以上の整数で入力してください");
  if (row.product_name.trim() === "") errors.push("商品名が未入力です");
  const tax = toNumber(row.tax_rate);
  if (tax !== 8 && tax !== 10) errors.push("消費税率は 8 または 10 を選択してください");
  if (!isNonNegInt(row.selling_price)) errors.push("販売価格は0以上の整数で入力してください");
  if (row.cost_price.trim() !== "" && !isNonNegInt(row.cost_price)) errors.push("原価は0以上の整数で入力してください");
  if (row.image_count.trim() !== "" && !isNonNegInt(row.image_count)) errors.push("作成した画像数は0以上の整数で入力してください");
  if (row.delivery_method.trim() !== "" && !isNonNegInt(row.delivery_method)) errors.push("配送方法セットは0以上の整数で入力してください");
  if (row.lead_time.trim() !== "" && !isNonNegInt(row.lead_time)) errors.push("納期管理番号は0以上の整数で入力してください");
  return errors;
}

/** 全行の検証。行番号(0始まり)→エラー一覧。空行は対象外。
 * グリッド内での NEコード重複も行単位のエラーとして返す（DBのユニーク制約に先回り）。 */
export function validateGridRows(rows: GridRow[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const seen = new Map<string, number>(); // ne_code → 最初の行番号
  rows.forEach((row, i) => {
    if (isRowBlank(row)) return;
    const errors = validateGridRow(row);
    const code = row.ne_code.trim();
    if (code !== "") {
      const first = seen.get(code);
      if (first !== undefined) errors.push(`NEコードが ${first + 1} 行目と重複しています`);
      else seen.set(code, i);
    }
    if (errors.length > 0) result.set(i, errors);
  });
  return result;
}

/** グリッド行 → ProductInput（既存スキーマで最終検証）。
 * 掲載商品名が空なら商品名を、任意数値が空なら既定値を採用する。 */
export function gridRowToProductInput(row: GridRow): ProductInput {
  return ProductInputSchema.parse({
    ne_code: row.ne_code.trim(),
    jan_code: row.jan_code.trim(),
    maker_code: row.maker_code.trim(),
    product_type: row.product_type,
    quantity: toNumber(row.quantity),
    product_name: row.product_name.trim(),
    display_name: row.display_name.trim() || row.product_name.trim(),
    tax_rate: toNumber(row.tax_rate),
    cost_price: row.cost_price.trim() === "" ? 0 : toNumber(row.cost_price),
    selling_price: toNumber(row.selling_price),
    shipping_type: row.shipping_type.trim() || "送料別",
    image_count: row.image_count.trim() === "" ? 1 : toNumber(row.image_count),
    delivery_method: row.delivery_method.trim() === "" ? 4 : toNumber(row.delivery_method),
    lead_time: row.lead_time.trim() === "" ? 1 : toNumber(row.lead_time),
    mall_category_id: row.mall_category_id.trim(),
    store_category: row.store_category.trim(),
    catch_copy_pc: row.catch_copy_pc.trim(),
    catch_copy_yahoo: row.catch_copy_yahoo.trim(),
  });
}

/** 「6,24,48」「6 24 48」のような数量指定をパース。正の整数のみ・重複除去。 */
export function parseQuantities(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,、\s]+/)) {
    if (part.trim() === "") continue;
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** 単品行からセット行を自動展開する（省力化の中核）。
 * Excel 実データのパターン: セット行は単品行の複製で、変わるのは
 * 「単品orセット商品 / 数量 / NEコード末尾 / 販売価格」だけ。
 * → 数量リストを渡すと共通項目を引き継いだセット行を生成し、販売価格だけ空欄で返す
 * （価格は数量に比例しないため人が入力する）。 */
export function expandSetRows(source: GridRow, quantities: number[]): GridRow[] {
  return quantities.map((qty) => {
    const next: GridRow = {
      ...source,
      auto: { ne_code: true, display_name: source.auto.display_name },
      product_type: "セット商品",
      quantity: String(qty),
      selling_price: "",
    };
    const s = suggestNeCode(next);
    if (s) {
      next.ne_code = s;
    } else {
      // NEコードが規約外(手入力)の場合は末尾の -数量 部分だけ付け替える
      const base = source.ne_code.trim();
      next.ne_code = base === "" ? "" : base.replace(/-\d+$/, "") + `-${qty}`;
      next.auto.ne_code = base === "";
    }
    return next;
  });
}

/** Excel からのコピー（TSV / クリップボード）を行に変換する。
 * - 引用符付き・セル内改行（Excel のコピー形式）は papaparse で解釈
 * - 見出し行（「NEコード」「JANコード」を含む行）は自動スキップ
 * - シート A 列（空欄）ごとコピーした場合は先頭の空列を自動で除去
 * - 列は「データ入力シート」の18列順として解釈し、余分な列は無視
 * - 空欄の NEコード・掲載商品名は取込直後に自動補完 */
export function parseTsv(text: string): GridRow[] {
  if (text.trim() === "") return [];
  const parsed = Papa.parse<string[]>(text, { delimiter: "\t", skipEmptyLines: true });
  let rows = (parsed.data ?? []).map((r) => r.map((c) => (c ?? "").trim()));
  if (rows.length === 0) return [];

  // 見出し行の検出（どこかのセルに列名そのものが入っている行）
  const isHeader = (r: string[]) => r.some((c) => c === "NEコード" || c === "JANコード");
  const headerIndex = rows.findIndex(isHeader);
  let offset = 0;
  if (headerIndex >= 0) {
    offset = Math.max(0, rows[headerIndex].indexOf("NEコード"));
    rows = rows.filter((r) => !isHeader(r));
  } else {
    // 見出し無しで「全行の先頭セルが空」かつ「列数が18列より多い」→ A列ごとコピーされたとみなす。
    // （NEコードだけ空欄の18列行を誤ってずらさないよう、列数も条件に入れる）
    const maxCols = Math.max(...rows.map((r) => r.length));
    if (maxCols > GRID_COLUMNS.length && rows.every((r) => (r[0] ?? "") === "")) offset = 1;
  }

  const out: GridRow[] = [];
  for (const cells of rows) {
    const row = emptyGridRow();
    COLUMN_KEYS.forEach((key, i) => {
      const v = cells[offset + i];
      if (v !== undefined && v !== "") row[key] = v;
    });
    if (isRowBlank(row)) continue;
    row.auto = { ne_code: row.ne_code.trim() === "", display_name: row.display_name.trim() === "" };
    out.push(autoFillRow(row));
  }
  return out;
}
