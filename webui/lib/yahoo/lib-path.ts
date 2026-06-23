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
  const name = index <= 1 ? p.ne_code : `${p.ne_code}_${index}`;
  const fileName = `${name}.jpg`;
  return { name, fileName, publicUrl: `${YAHOO_IMAGE_BASE}/${fileName}` };
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
