import Papa from "papaparse";
import type { NeSyohinRow, NeSetRow, HimodukeRow, ExcelMasterRow, ExcelMallRow, Mall } from "./types";

/** 全ソース papaparse で論理レコード化（クォート/エスケープ/引用符内改行に対応）。 */
function rows(text: string): string[][] {
  const out = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return (out.data as string[][]) ?? [];
}
function cell(c: string[], i: number): string {
  return (c[i] ?? "").trim();
}
function num(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
const CODE = /^[A-Za-z0-9_-]+$/;

/** NE商品マスタ(単品): syohin_code,syohin_name,baika_tnk,tax_rate,zaiko_su */
export function parseNeSyohin(text: string): NeSyohinRow[] {
  return rows(text)
    .slice(1)
    .filter((c) => cell(c, 0) !== "")
    .map((c) => ({ ne_code: cell(c, 0), name: cell(c, 1), selling_price: num(c[2]), tax_rate: num(c[3]) }));
}

/** NEセットマスタ(RFCクォート142列・説明文に改行→複数物理行)。先頭8列をindex取得し、
 * [0]/[5]がコード書式・[6]が整数の行のみ採用（残骸行はskip）。line.split禁止。 */
export function parseNeSet(text: string): NeSetRow[] {
  const out: NeSetRow[] = [];
  for (const c of rows(text).slice(1)) {
    const set_ne_code = cell(c, 0);
    const component_ne_code = cell(c, 5);
    const suryoStr = cell(c, 6);
    if (!CODE.test(set_ne_code) || !CODE.test(component_ne_code) || !/^[0-9]+$/.test(suryoStr)) continue;
    out.push({
      set_ne_code,
      daihyo_code: cell(c, 1),
      set_name: cell(c, 2),
      set_price: num(c[3]),
      tax_rate: num(c[4]),
      component_ne_code,
      suryo: Number(suryoStr),
      jan_code: cell(c, 7),
    });
  }
  return out;
}

/** NE紐づけ表: 商品コード(0),代表(1),取込元(2),商品名(3),在庫連携(4),...モール列 */
export function parseHimoduke(text: string): HimodukeRow[] {
  return rows(text)
    .slice(1)
    .filter((c) => cell(c, 0) !== "")
    .map((c) => ({ ne_code: cell(c, 0), daihyo_code: cell(c, 1), zaiko_renkei: cell(c, 4) }));
}

/** Excel商品マスタ: 仕入先(0),JAN(1),NEコード(2),仕入先CD(3),商品名(4),仕入価(5),税率(6),カテゴリ(7),備品フラグ(8)。
 * 備品(NEコード空)は除外。 */
export function parseExcelMaster(text: string): ExcelMasterRow[] {
  const out: ExcelMasterRow[] = [];
  for (const c of rows(text).slice(1)) {
    const ne_code = cell(c, 2);
    if (ne_code === "") continue;
    out.push({
      ne_code,
      jan_code: cell(c, 1),
      name: cell(c, 4),
      cost_price: num(c[5]),
      tax_rate: num(c[6]),
      category: cell(c, 7),
      supplier: cell(c, 0),
    });
  }
  return out;
}

/** Excel終売品マスタ: 同じ列構成のうち NEコード(2) のみ採用（終売判定用）。 */
export function parseExcelDiscon(text: string): string[] {
  return rows(text)
    .slice(1)
    .map((c) => cell(c, 2))
    .filter((ne) => ne !== "");
}

/** Excelモール一覧: 楽天=商品番号(1)=ne, しまのや=商品コード(0)=ne, Yahoo/amazon=ne列なし(空)。 */
export function parseExcelMall(text: string, mall: Mall): ExcelMallRow[] {
  const body = rows(text)
    .slice(1)
    .filter((c) => cell(c, 0) !== "");
  if (mall === "rakuten") {
    // 商品管理番号(0),商品番号(1=ne),項目名(2),選択肢(3),JAN(4),商品名(5),数量(6)
    return body.map((c) => ({ manage_no: cell(c, 0), ne_code: cell(c, 1), jan_code: cell(c, 4), suryo: num(c[6]) }));
  }
  if (mall === "shimanoya") {
    // 商品コード(0=ne),分析用CD(1),名称(2),入数(3)
    return body.map((c) => ({ manage_no: cell(c, 0), ne_code: cell(c, 0), jan_code: "", suryo: num(c[3]) }));
  }
  // yahoo/amazon: 商品管理番号(0),項目名(1),選択肢(2),JAN(3),商品名(4),数量(5) — ne列なし
  return body.map((c) => ({ manage_no: cell(c, 0), ne_code: "", jan_code: cell(c, 3), suryo: num(c[5]) }));
}
