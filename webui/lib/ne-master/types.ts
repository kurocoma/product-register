export type Mall = "rakuten" | "yahoo" | "amazon" | "shimanoya";

/** ソース別の生レコード（parse.ts の出力） */
export type NeSyohinRow = { ne_code: string; name: string; selling_price: number | null; tax_rate: number | null };
export type NeSetRow = {
  set_ne_code: string; daihyo_code: string; set_name: string; set_price: number | null; tax_rate: number | null;
  component_ne_code: string; suryo: number; jan_code: string;
};
export type HimodukeRow = { ne_code: string; daihyo_code: string; zaiko_renkei: string };
export type ExcelMasterRow = { ne_code: string; jan_code: string; name: string; cost_price: number | null; tax_rate: number | null; category: string; supplier: string };
export type ExcelMallRow = { manage_no: string; ne_code: string; jan_code: string; suryo: number | null };
