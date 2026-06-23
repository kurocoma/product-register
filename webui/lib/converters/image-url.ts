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

/** Yahoo R-Cabinet 相当(店舗画像ライブラリ)の商品画像URLの並び。
 * 1 枚目 = {neCode}.jpg、2 枚目以降 = {neCode}_{n}.jpg。公開時(item-image-urls)と共通。 */
export function buildYahooImageUrls(neCode: string, imageCount: number): string[] {
  if (imageCount <= 0) return [];
  return Array.from({ length: imageCount }, (_, i) =>
    i === 0 ? `${YAHOO_IMAGE_BASE}/${neCode}.jpg` : `${YAHOO_IMAGE_BASE}/${neCode}_${i + 1}.jpg`,
  );
}

/** Yahoo item-image-urls 列 (セミコロン区切り) */
export function buildYahooItemImageUrls(neCode: string, imageCount: number): string {
  return buildYahooImageUrls(neCode, imageCount).join(";");
}
