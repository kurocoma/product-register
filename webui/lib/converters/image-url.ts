const RAKUTEN_IMAGE_BASE = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02";
const YAHOO_IMAGE_BASE = "https://shopping.c.yimg.jp/lib/okimarumarket";

/** 楽天用 imgList HTML (2 枚目以降を <img> で並べる、シングルクォート) */
export function buildRakutenImgList(baseCode: string, imageCount: number): string {
  if (imageCount <= 1) return "";
  const imgs = Array.from(
    { length: imageCount - 1 },
    (_, i) => `<img src='${RAKUTEN_IMAGE_BASE}/${baseCode}_${i + 2}.jpg' width='100%'>`,
  ).join("<br>");
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

/** Yahoo item-image-urls 列 (セミコロン区切り) */
export function buildYahooItemImageUrls(neCode: string, imageCount: number): string {
  if (imageCount <= 0) return "";
  return Array.from({ length: imageCount }, (_, i) =>
    i === 0 ? `${YAHOO_IMAGE_BASE}/${neCode}.jpg` : `${YAHOO_IMAGE_BASE}/${neCode}_${i + 1}.jpg`,
  ).join(";");
}
