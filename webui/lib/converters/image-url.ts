import { DEFAULT_RAKUTEN_STORE, rakutenCabinetBase } from "@/lib/rakuten/store";

export const RAKUTEN_IMAGE_BASE = rakutenCabinetBase(DEFAULT_RAKUTEN_STORE, "thum02");
export const YAHOO_IMAGE_BASE = "https://shopping.c.yimg.jp/lib/okimarumarket";

/** sale_desc(imgList) に並ぶ 2 枚目以降の画像URL: {base}_{n}.jpg (n=2..imageCount)。 */
function rakutenImgListUrls(baseCode: string, imageCount: number): string[] {
  if (imageCount <= 1) return [];
  return Array.from(
    { length: imageCount - 1 },
    (_, i) => `${RAKUTEN_IMAGE_BASE}/${baseCode}_${i + 2}.jpg`,
  );
}

/** 楽天 R-Cabinet の商品画像URLの並び（公開時と同じ規約）。
 * 1 枚目 = {neCode}.jpg（商品画像1）、2 枚目以降 = {base}_{n}.jpg（sale_desc と同じ）。 */
export function buildRakutenImageUrls(
  baseCode: string,
  neCode: string,
  imageCount: number,
): string[] {
  if (imageCount <= 0) return [];
  return [`${RAKUTEN_IMAGE_BASE}/${neCode}.jpg`, ...rakutenImgListUrls(baseCode, imageCount)];
}

/** 楽天用 imgList HTML (2 枚目以降を <img> で並べる、シングルクォート) */
export function buildRakutenImgList(baseCode: string, imageCount: number): string {
  if (imageCount <= 1) return "";
  const imgs = rakutenImgListUrls(baseCode, imageCount)
    .map((u) => `<img src='${u}' width='100%'>`)
    .join("<br>");
  return `<!--imgList-->${imgs}<br><!--/imgList-->`;
}

/** Yahoo caption 内 imgList HTML (Phase 1 と同形式) */
export function buildYahooImgListHtml(neCode: string, imageCount: number): string {
  if (imageCount <= 1) return "";
  const imgs = Array.from(
    { length: imageCount - 1 },
    (_, i) => `<img src='${YAHOO_IMAGE_BASE}/${neCode}_${i + 2}.jpg' width='100%'>`,
  ).join("<br>");
  return `<!--imgList-->${imgs}<br><!--/imgList-->`;
}

/** lib 基底URL。sellerId 指定時は実ストアの lib/{sellerId} を使う（A3: 動的化）。
 * 未指定なら従来の既定（okimarumarket）にフォールバック（後方互換）。 */
function yahooLibBase(sellerId?: string): string {
  return sellerId ? `https://shopping.c.yimg.jp/lib/${sellerId}` : YAHOO_IMAGE_BASE;
}

/** 画像 index(1 始まり) → 公開URL。1 枚目 = {neCode}.jpg、2 枚目以降 = {neCode}_{index}.jpg。 */
function yahooImageUrlForIndex(neCode: string, index: number, sellerId?: string): string {
  const base = yahooLibBase(sellerId);
  return index <= 1 ? `${base}/${neCode}.jpg` : `${base}/${neCode}_${index}.jpg`;
}

/** Yahoo R-Cabinet 相当(店舗画像ライブラリ)の商品画像URLの並び。
 * 1 枚目 = {neCode}.jpg、2 枚目以降 = {neCode}_{n}.jpg。公開時(item-image-urls)と共通。
 *
 * 第2引数は枚数(number)か、実在する画像 index 配列(number[])を受ける:
 * - number  … 1..count の連番（従来挙動・後方互換）。
 * - number[] … 指定 index のみで構築（アップロード成功した画像だけで item_image_urls を組む / A2）。
 * 第3引数 sellerId 指定時は基底URLを lib/{sellerId} に切り替える（A3）。未指定は従来基底。 */
export function buildYahooImageUrls(
  neCode: string,
  imageCountOrIndices: number | number[],
  sellerId?: string,
): string[] {
  const indices = Array.isArray(imageCountOrIndices)
    ? imageCountOrIndices
    : imageCountOrIndices <= 0
      ? []
      : Array.from({ length: imageCountOrIndices }, (_, i) => i + 1);
  return indices.map((idx) => yahooImageUrlForIndex(neCode, idx, sellerId));
}

/** Yahoo item-image-urls 列 (セミコロン区切り)。
 * 第2引数は枚数または画像 index 配列、第3引数 sellerId で基底URLを動的化（buildYahooImageUrls 参照）。 */
export function buildYahooItemImageUrls(
  neCode: string,
  imageCountOrIndices: number | number[],
  sellerId?: string,
): string {
  return buildYahooImageUrls(neCode, imageCountOrIndices, sellerId).join(";");
}
