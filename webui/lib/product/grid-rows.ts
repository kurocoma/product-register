import Papa from "papaparse";
import { ProductInputSchema, type ProductInput } from "./schema";

/** 一括登録グリッドの追加列「バリエーションキー」:
 * 同じ値を入れた行は保存時に1商品へ統合され、楽天では同じ商品管理番号
 * （メーカーコード-JAN下4桁）配下のSKU（バリエーション）として登録される。
 * NE側はSKUごとに分ける必要があるため、NE用CSVは従来どおり行ごとに出力される。 */

/** 一括登録グリッド（Excel「データ入力シート」B〜S列相当の基本18列 + 拡張9列）の純関数層。
 *
 * 基本18列(データ入力シート 3行目見出しの列順):
 * NEコード / JANコード / メーカーコード / 単品orセット商品 / 数量 / 商品名 / 掲載商品名 /
 * 消費税率 / 原価 / 販売価格 / 送料区分 / 作成した画像数 / 配送方法セット / 納期管理番号 /
 * モール基本カテゴリID / 店舗内カテゴリ1 / キャッチコピーPC / キャッチコピー(Yahoo)
 *
 * 拡張9列(商品編集画面 ProductForm/schema の棚卸しから採用。基本18列の後ろに追加):
 * PC用販売説明文 / 商品説明PC / 商品説明スマホ / 検索キーワード / メーカー名 / ブランド名 /
 * YahooカテゴリID / Yahooストアカテゴリパス / 単位
 *
 * 列定義は ALL_GRID_COLUMNS が単一源泉:
 * グリッド見出し・貼り付け取込(parseTsv)の列解釈・テンプレートCSV(buildTemplateCsv)の
 * 3者が同じ配列を参照するため、列を足すときはここに1行足すだけで全てが揃う。
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
  // --- 拡張列（商品編集画面の主要項目をグリッドでも入力可能に） ---
  sale_description_pc: string; // PC用販売説明文（楽天・HTML可）
  description_pc: string; // 商品説明PC（HTML可）
  description_sp: string; // 商品説明スマホ（HTML可）
  keyword: string;
  maker_name: string;
  brand_name: string;
  yahoo_category_id: string;
  yahoo_path: string;
  unit: string; // 本/袋/個/枚 等
  /** バリエーションキー（同じ値の行は保存時に1商品へ統合）。
   * 既存27列の後方互換を保つため optional（未入力の行はプロパティ自体を持たない）。 */
  variation_key?: string;
  /** 自動補完の管理フラグ。ユーザーが手入力したら false になり追従を止める。 */
  auto: { ne_code: boolean; display_name: boolean };
};

export type GridColumnKey = Exclude<keyof GridRow, "auto">;

export type GridColumn = {
  key: GridColumnKey;
  label: string;
  /** 列グループ見出し（基本情報/価格/配送/カテゴリ/商品説明/Yahoo）。連続する同名列を束ねて表示する。 */
  group: string;
  /** 必須入力（保存に必要）なら true。見出しに * を付ける。 */
  required?: boolean;
  /** セル入力の種類。select は options から選択。 */
  input: "text" | "number" | "select";
  options?: string[];
  /** 長文列（説明文HTML等）。セル内では抜粋表示し、クリックで下部の拡大エディタで編集する。 */
  long?: boolean;
  /** Tailwind 幅クラス（グリッドの列幅） */
  width: string;
  /** 自動補完される列の説明（ツールチップ表示用） */
  autoHint?: string;
  /** 新規行の既定値（未指定は空文字）。emptyGridRow の単一源泉。 */
  defaultValue?: string;
  /** テンプレートCSVの入力例（2行目に載せる。全列そろえて「そのまま貼り付けて保存できる」1行にする） */
  example?: string;
  /** バリエーション統合デモ用の2行目入力例（未指定列は example を引き継ぐ）。
   * バリエーションキー入りテンプレートだけが使う（従来テンプレの出力は不変）。 */
  example2?: string;
  /** バリエーションキー入りテンプレート（BULK_GRID_COLUMNS）専用の入力例。
   * "" を明示すると空欄になる（例: YahooカテゴリID/パスは空欄のまま保存時に自動補完＝
   * 「カテゴリIDのみ入力→保存で補完」を例自体が体現する）。未指定は example を使う。
   * 既定27列テンプレの出力には影響しない。 */
  bulkExample?: string;
};

/** データ入力シートの列順そのまま（基本18列）。 */
export const GRID_COLUMNS: GridColumn[] = [
  { key: "ne_code", label: "NEコード", group: "基本情報", required: true, input: "text", width: "w-32", autoHint: "メーカーコード-JAN下4桁-数量 から自動生成（手修正可）", example: "a009-4916-1", example2: "a009-4916-6" },
  { key: "jan_code", label: "JANコード", group: "基本情報", required: true, input: "text", width: "w-36", example: "4514603474916" },
  { key: "maker_code", label: "メーカーコード", group: "基本情報", required: true, input: "text", width: "w-24", example: "a009" },
  { key: "product_type", label: "単品orセット商品", group: "基本情報", required: true, input: "select", options: ["単品", "セット商品"], width: "w-28", defaultValue: "単品", example: "単品", example2: "セット商品" },
  { key: "quantity", label: "数量", group: "基本情報", required: true, input: "number", width: "w-16", defaultValue: "1", example: "1", example2: "6" },
  { key: "product_name", label: "商品名", group: "基本情報", required: true, input: "text", width: "w-64", example: "沖縄バヤリース 島レモネード PET 500ml" },
  { key: "display_name", label: "掲載商品名", group: "基本情報", input: "text", width: "w-64", autoHint: "商品名から自動補完（手修正可）", example: "沖縄バヤリース 島レモネード PET 500ml" },
  { key: "tax_rate", label: "消費税率", group: "価格", required: true, input: "select", options: ["8", "10"], width: "w-16", defaultValue: "10", example: "8" },
  { key: "cost_price", label: "原価", group: "価格", input: "number", width: "w-20", example: "123" },
  { key: "selling_price", label: "販売価格", group: "価格", required: true, input: "number", width: "w-24", example: "200", example2: "1080" },
  { key: "shipping_type", label: "送料区分", group: "配送", input: "select", options: ["送料別", "送料無料"], width: "w-24", defaultValue: "送料別", example: "送料別" },
  { key: "image_count", label: "作成した画像数", group: "配送", input: "number", width: "w-16", defaultValue: "1", example: "6" },
  { key: "delivery_method", label: "配送方法セット", group: "配送", input: "number", width: "w-16", defaultValue: "4", example: "4" },
  { key: "lead_time", label: "納期管理番号", group: "配送", input: "number", width: "w-16", defaultValue: "1", example: "1" },
  { key: "mall_category_id", label: "モール基本カテゴリID", group: "カテゴリ", input: "text", width: "w-28", autoHint: "これを入力すれば保存時に商品属性（項目・単位）と YahooカテゴリID/パスを自動補完（手入力があれば手入力を優先）", example: "110692" },
  { key: "store_category", label: "店舗内カテゴリ1", group: "カテゴリ", input: "text", width: "w-40", example: "フルーツ・ソフトドリンク・酢" },
  { key: "catch_copy_pc", label: "キャッチコピーPC", group: "商品説明", input: "text", width: "w-56", example: "沖縄の夏を彩る島レモネード！" },
  { key: "catch_copy_yahoo", label: "キャッチコピー(Yahoo)", group: "商品説明", input: "text", width: "w-56", example: "沖縄の夏を彩る島レモネード！" },
];

/** 拡張9列（商品編集画面 ProductForm/schema の棚卸しから採用）。
 * 既存シートからの18列コピペを壊さないよう、必ず基本18列の「後ろ」に追加する。 */
export const GRID_COLUMNS_EXTRA: GridColumn[] = [
  { key: "sale_description_pc", label: "PC用販売説明文", group: "商品説明", input: "text", long: true, width: "w-44", autoHint: "空欄なら画像枚数から imgList を自動生成（楽天・HTML可）", example: "<p>沖縄限定の島レモネード。まとめ買いがお得です。</p>" },
  { key: "description_pc", label: "商品説明PC", group: "商品説明", input: "text", long: true, width: "w-44", example: "<p>シークヮーサー果汁入り。沖縄限定の島レモネードです。</p>" },
  { key: "description_sp", label: "商品説明スマホ", group: "商品説明", input: "text", long: true, width: "w-44", example: "シークヮーサー果汁入り。沖縄限定の島レモネードです。" },
  { key: "keyword", label: "検索キーワード", group: "商品説明", input: "text", width: "w-44", example: "レモネード 沖縄 バヤリース" },
  { key: "maker_name", label: "メーカー名", group: "商品説明", input: "text", width: "w-32", example: "沖縄バヤリース" },
  { key: "brand_name", label: "ブランド名", group: "商品説明", input: "text", width: "w-32", example: "バヤリース" },
  // Yahoo 2列: バリエーションキー入りテンプレ（bulkExample）では空欄にする
  // （空欄→保存時にモール基本カテゴリIDから自動補完される、を入力例自体が体現するため）
  { key: "yahoo_category_id", label: "YahooカテゴリID", group: "Yahoo", input: "text", width: "w-28", autoHint: "空欄ならモール基本カテゴリIDから保存時に自動補完（手入力優先）", example: "13457", bulkExample: "" },
  { key: "yahoo_path", label: "Yahooストアカテゴリパス", group: "Yahoo", input: "text", width: "w-48", autoHint: "空欄ならモール基本カテゴリIDから保存時に自動補完（手入力優先）", example: "食品、飲料、製菓＞ソフトドリンク、ジュース", bulkExample: "" },
  { key: "unit", label: "単位", group: "Yahoo", input: "text", width: "w-16", example: "本" },
];

/** 全列（基本18列 + 拡張9列）。グリッド見出し・parseTsv・テンプレートCSV の単一源泉。 */
export const ALL_GRID_COLUMNS: GridColumn[] = [...GRID_COLUMNS, ...GRID_COLUMNS_EXTRA];

/** バリエーションキー列。既存27列の「後ろ」に置く（旧テンプレ・基本18列コピペを壊さない）。 */
export const VARIATION_KEY_COLUMN: GridColumn = {
  key: "variation_key",
  label: "バリエーションキー",
  group: "バリエーション",
  input: "text",
  width: "w-36",
  autoHint: "同じ値の行は保存時に1商品へ統合され、楽天では同じ商品管理番号（メーカーコード-JAN下4桁）のSKUになります。NE用CSVは従来どおり行ごとに出力されます",
  example: "レモネード500",
};

/** 一括登録グリッドの全列（27列 + バリエーションキー）。
 * グリッドUI・貼り付け取込・テンプレートCSV（UI からのDL）はこちらを単一源泉に使う。 */
export const BULK_GRID_COLUMNS: GridColumn[] = [...ALL_GRID_COLUMNS, VARIATION_KEY_COLUMN];

const COLUMN_KEYS: GridColumnKey[] = ALL_GRID_COLUMNS.map((c) => c.key);
const BULK_COLUMN_KEYS: GridColumnKey[] = BULK_GRID_COLUMNS.map((c) => c.key);

/** 連続する同じ group の列を束ねる（グリッドの列グループ見出し行用）。 */
export function columnGroups(columns: GridColumn[] = ALL_GRID_COLUMNS): { name: string; span: number }[] {
  const out: { name: string; span: number }[] = [];
  for (const c of columns) {
    const last = out[out.length - 1];
    if (last && last.name === c.group) last.span++;
    else out.push({ name: c.group, span: 1 });
  }
  return out;
}

export const TEMPLATE_FILENAME = "商品一括登録テンプレート.csv";

/** テンプレート末尾の説明行。先頭が「※」の行は貼り付け取込（parseTsv）が自動で読み飛ばす。 */
export const TEMPLATE_NOTE =
  "※入力のコツ: カテゴリは「モール基本カテゴリID」だけ入力すればOKです（商品属性の項目・単位と YahooカテゴリID/パスは空欄のままで、保存時に自動補完されます。手入力があれば手入力を優先）。" +
  "バリエーションキーが同じ行（上の2行が例）は保存時に1商品へ統合され、楽天では同じ商品管理番号（メーカーコード-JAN下4桁）のSKUとして登録されます。NE用CSVは従来どおり行ごとに出力されます。この※で始まる行は貼り付け時に無視されます。";

/** 貼り付け取込用テンプレートCSVを生成する（UTF-8 BOM 付き = Excel でそのまま開ける）。
 * 1行目 = グリッド列と同一の見出し（列定義が単一源泉）、2行目 = 入力例1行。
 * バリエーションキー列を含む列定義（BULK_GRID_COLUMNS）で呼ぶと、同じキーで統合される
 * セット行の入力例（3行目）と説明行（※・4行目）を追加する。既定の27列テンプレは従来と同一出力。
 * バリエーションキー入りテンプレでは bulkExample を優先する（YahooカテゴリID/パスを空欄にして
 * 「モール基本カテゴリIDのみ入力→保存で自動補完」を入力例のまま体現する。※説明行と挙動が一致）。 */
export function buildTemplateCsv(columns: GridColumn[] = ALL_GRID_COLUMNS): string {
  const hasVariationKey = columns.some((c) => c.key === "variation_key");
  const exampleOf = (c: GridColumn) =>
    (hasVariationKey ? c.bulkExample ?? c.example : c.example) ?? c.defaultValue ?? "";
  const header = columns.map((c) => c.label);
  const example = columns.map(exampleOf);
  const rows: string[][] = [header, example];
  if (hasVariationKey) {
    rows.push(columns.map((c) => c.example2 ?? exampleOf(c)));
    rows.push([TEMPLATE_NOTE]);
  }
  return "\uFEFF" + Papa.unparse(rows, { newline: "\r\n" });
}

/** 新規行。よく使う値（税率10/送料別/配送方法4/納期1/数量1/画像数1）を既定値でプリセット。
 * 既定値は列定義（defaultValue）が単一源泉。 */
export function emptyGridRow(): GridRow {
  const values = Object.fromEntries(
    ALL_GRID_COLUMNS.map((c) => [c.key, c.defaultValue ?? ""]),
  ) as Record<GridColumnKey, string>;
  return { ...values, auto: { ne_code: true, display_name: true } };
}

/** 既定値のまま何も入力されていない行か（保存・検証の対象外にする）。 */
export function isRowBlank(row: GridRow): boolean {
  const base = emptyGridRow();
  return COLUMN_KEYS.every((k) => (row[k] ?? "").trim() === "" || row[k] === base[k]);
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

/** グリッド行 → ProductInputSchema.parse に渡す生オブジェクト。
 * gridRowToProductInput（1行=1商品）と buildProductsFromRows（バリエーション統合）が共有する。 */
function gridRowToRaw(row: GridRow): Record<string, unknown> {
  return {
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
    // 拡張列（商品編集画面と同じフィールドへそのまま保存される）
    sale_description_pc: row.sale_description_pc.trim(),
    description_pc: row.description_pc.trim(),
    description_sp: row.description_sp.trim(),
    keyword: row.keyword.trim(),
    maker_name: row.maker_name.trim(),
    brand_name: row.brand_name.trim(),
    yahoo_category_id: row.yahoo_category_id.trim(),
    yahoo_path: row.yahoo_path.trim(),
    unit: row.unit.trim(),
    variation_key: (row.variation_key ?? "").trim(),
  };
}

/** グリッド行 → ProductInput（既存スキーマで最終検証）。
 * 掲載商品名が空なら商品名を、任意数値が空なら既定値を採用する。 */
export function gridRowToProductInput(row: GridRow): ProductInput {
  return ProductInputSchema.parse(gridRowToRaw(row));
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
 * - 見出し行（「NEコード」「JANコード」を含む行）と説明行（先頭セルが「※」で始まる行）は自動スキップ
 * - シート A 列（空欄）ごとコピーした場合は先頭の空列を自動で除去
 * - 列は BULK_GRID_COLUMNS の列順（基本18列+拡張9列+バリエーションキー）として解釈し、余分な列は無視。
 *   旧シートどおり基本18列・従来27列だけの貼り付けも先頭からの部分列としてそのまま取り込める
 * - 空欄の NEコード・掲載商品名は取込直後に自動補完 */
export function parseTsv(text: string): GridRow[] {
  if (text.trim() === "") return [];
  const parsed = Papa.parse<string[]>(text, { delimiter: "\t", skipEmptyLines: true });
  let rows = (parsed.data ?? []).map((r) => r.map((c) => (c ?? "").trim()));
  // 説明行（テンプレの ※ 行など）は列解釈の前に除外する
  rows = rows.filter((r) => !(r[0] ?? "").startsWith("※"));
  if (rows.length === 0) return [];

  // 見出し行の検出（どこかのセルに列名そのものが入っている行）
  const isHeader = (r: string[]) => r.some((c) => c === "NEコード" || c === "JANコード");
  const headerIndex = rows.findIndex(isHeader);
  let offset = 0;
  if (headerIndex >= 0) {
    offset = Math.max(0, rows[headerIndex].indexOf("NEコード"));
    rows = rows.filter((r) => !isHeader(r));
  } else if (rows.every((r) => (r[0] ?? "") === "")) {
    // 見出し無しで先頭セルが全行空: 「シートA列(空列)ごとコピー」か「NEコード空欄(自動生成待ち)」かを判定する。
    // 1) 必須の JANコード(13桁) の位置で判定: 定位置(2列目)にあれば NEコード空欄、1つ右(3列目)なら A列混入。
    const janAt = (i: number) => rows.some((r) => /^\d{13}$/.test(r[i] ?? ""));
    if (janAt(2) && !janAt(1)) {
      offset = 1;
    } else if (!janAt(1)) {
      // 2) JAN でも判別できない場合は列数で判定: 全列(28列)より多い → A列混入とみなす。
      const maxCols = Math.max(...rows.map((r) => r.length));
      if (maxCols > BULK_GRID_COLUMNS.length) offset = 1;
    }
  }

  const out: GridRow[] = [];
  for (const cells of rows) {
    const row = emptyGridRow();
    BULK_COLUMN_KEYS.forEach((key, i) => {
      const v = cells[offset + i];
      if (v !== undefined && v !== "") row[key] = v;
    });
    if (isRowBlank(row)) continue;
    row.auto = { ne_code: row.ne_code.trim() === "", display_name: row.display_name.trim() === "" };
    out.push(autoFillRow(row));
  }
  return out;
}

/** buildProductsFromRows の1件分。保存する ProductInput と、元になった行の対応を持つ。 */
export type BuiltProduct = {
  /** 保存する商品。行に入力エラーがある場合は null（理由は errors）。 */
  input: ProductInput | null;
  /** 元 rows 配列でのインデックス（統合グループは数量昇順に並ぶ）。 */
  rowIndexes: number[];
  /** バリエーションキー（統合なしの単独行は ""）。 */
  variationKey: string;
  /** 行インデックス → エラー一覧。自身にエラーが無い行には統合グループの連帯スキップ理由が入る。 */
  errors: Map<number, string[]>;
};

/** バリエーションのSKU選択肢ラベル（例 "1本" / "6本"）。単位列があればそれを使う。 */
function variationLabelOf(row: GridRow): string {
  const unit = row.unit.trim() || "本";
  return `${toNumber(row.quantity)}${unit}`;
}

/** グリッド行の集合 → 保存する ProductInput の一覧（バリエーションキー統合の中核）。
 * - バリエーションキーが空の行: 従来どおり 1行 = 1商品。
 * - 同じバリエーションキーの行: 1商品に統合し variants[]（SKU別 NEコード=システム連携用SKU番号・
 *   JAN・価格・数量・送料区分）を生成する。代表行 = 数量最小行（商品名・説明などの商品ページ共通
 *   項目は代表行から採用）。楽天の商品管理番号（rakuten_manage_number）は下9桁 base 形式
 *   （メーカーコード-JAN下4桁、例 a009-4916）に固定する。NE側は分けたままにする必要があるため、
 *   NE用CSVは統合後も converters/ne.ts が variants をSKUごとの行に展開する。
 * - 入力エラー行を含む統合グループは商品を作らず、全行に理由を返す（部分統合を防ぐ）。
 * 空行はスキップ。行の検証は validateGridRows と同一基準。 */
export function buildProductsFromRows(rows: GridRow[]): BuiltProduct[] {
  const rowErrors = validateGridRows(rows);
  type Entry = { row: GridRow; index: number };
  const groups = new Map<string, Entry[]>();
  const sequence: (Entry | { key: string })[] = []; // 出現順を保つ
  rows.forEach((row, index) => {
    if (isRowBlank(row)) return;
    const key = (row.variation_key ?? "").trim();
    if (key === "") {
      sequence.push({ row, index });
      return;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
      sequence.push({ key });
    }
    groups.get(key)!.push({ row, index });
  });

  const out: BuiltProduct[] = [];
  for (const item of sequence) {
    if ("key" in item) {
      const members = [...groups.get(item.key)!].sort(
        (a, b) => toNumber(a.row.quantity) - toNumber(b.row.quantity),
      );
      const indexes = members.map((m) => m.index);
      const errors = new Map<number, string[]>();
      if (members.some((m) => rowErrors.has(m.index))) {
        for (const m of members) {
          errors.set(
            m.index,
            rowErrors.get(m.index) ?? [
              `同じバリエーションキー「${item.key}」の行に入力エラーがあるため、統合保存をスキップしました`,
            ],
          );
        }
        out.push({ input: null, rowIndexes: indexes, variationKey: item.key, errors });
        continue;
      }
      const rep = members[0]; // 数量最小行を代表に（商品ページ共通項目の採用元）
      const variants = members.map(({ row }) => ({
        sku_manage_number: row.ne_code.trim(),
        ne_code: row.ne_code.trim(), // システム連携用SKU番号（merchantDefinedSkuId）
        jan_code: row.jan_code.trim(),
        selling_price: toNumber(row.selling_price),
        tax_rate: toNumber(row.tax_rate),
        quantity: toNumber(row.quantity),
        variation_value: variationLabelOf(row),
        shipping_type: row.shipping_type.trim() || "送料別",
      }));
      const input = ProductInputSchema.parse({
        ...gridRowToRaw(rep.row),
        variation_key: item.key,
        // 楽天の商品管理番号 = 下9桁 base 形式（メーカーコード-JAN下4桁）
        rakuten_manage_number: `${rep.row.maker_code.trim()}-${rep.row.jan_code.trim().slice(-4)}`,
        variants,
      });
      out.push({ input, rowIndexes: indexes, variationKey: item.key, errors });
      continue;
    }
    // 統合なし: 従来どおり 1行 = 1商品
    const errors = new Map<number, string[]>();
    const own = rowErrors.get(item.index);
    if (own) {
      errors.set(item.index, own);
      out.push({ input: null, rowIndexes: [item.index], variationKey: "", errors });
      continue;
    }
    out.push({
      input: ProductInputSchema.parse(gridRowToRaw(item.row)),
      rowIndexes: [item.index],
      variationKey: "",
      errors,
    });
  }
  return out;
}
