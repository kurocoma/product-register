import type { ProductInput } from "@/lib/product/schema";
import { YAHOO_IMAGE_BASE } from "@/lib/converters/image-url";

/** Yahoo 追加画像(lib)の命名規約。image-url.ts の buildYahooImageUrls と一致させる:
 * 1枚目 = {ne_code}.jpg、2枚目以降 = {ne_code}_{index}.jpg（Rakuten と違い base でなく ne_code）。 */
export type YahooLibTarget = {
  /** 拡張子を除いた名前 */
  name: string;
  /** API/URL に使うファイル名(拡張子込み) */
  fileName: string;
  /** 公開URL(フラット): {YAHOO_IMAGE_BASE}/{fileName} */
  publicUrl: string;
};

export function buildYahooLibFileName(p: ProductInput, index: number): YahooLibTarget {
  return buildYahooLibFileNameByCode(p.ne_code, index);
}

/** 商品コード文字列から lib ファイル名を組む（DB未登録の新規商品コードへの先行アップロード用）。 */
export function buildYahooLibFileNameByCode(code: string, index: number): YahooLibTarget {
  const name = index <= 1 ? code : `${code}_${index}`;
  const fileName = `${name}.jpg`;
  return { name, fileName, publicUrl: `${YAHOO_IMAGE_BASE}/${fileName}` };
}

/** Yahoo 商品画像(item image)の命名規約（uploadItemImage 公式仕様）:
 * メイン(1枚目) = {商品コード}.jpg、商品詳細画像(2枚目以降) = {商品コード}_{1..20}.jpg。
 * 追加画像(lib)と違い2枚目のサフィックスは _1 から始まる点に注意。 */
export function buildYahooItemImageFileName(code: string, index: number): string {
  return index <= 1 ? `${code}.jpg` : `${code}_${index - 1}.jpg`;
}

/** Yahoo 追加画像ファイル名の制約検証（半角英数・-_.・40バイト以内）。 */
export function validateYahooFileName(
  fileName: string,
): { ok: true } | { ok: false; reason: string } {
  if (!fileName) return { ok: false, reason: "ファイル名が空です" };
  if (Buffer.byteLength(fileName, "utf8") > 40) {
    return { ok: false, reason: `ファイル名は40バイト以内です（${fileName} は ${Buffer.byteLength(fileName, "utf8")}バイト）` };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
    return { ok: false, reason: "使用できない文字が含まれています（半角英数と -_. のみ）" };
  }
  return { ok: true };
}
