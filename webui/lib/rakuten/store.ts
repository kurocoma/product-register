/** 楽天店舗・R-Cabinet 関連の共有定数。
 * 店舗名(ichiban-okinawa)が変換器・プレビュー・アップロードに散在しないよう一元化する。 */

export const DEFAULT_RAKUTEN_STORE = "ichiban-okinawa";

/** R-Cabinet の公開画像URLベースを組み立てる。
 * 例: rakutenCabinetBase("ichiban-okinawa", "thum02")
 *   → "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02" */
export function rakutenCabinetBase(store: string, folder: string): string {
  return `https://image.rakuten.co.jp/${store}/cabinet/${folder}`;
}

/** R-Cabinet のアップロード対象フォルダ。folderId は files/search で実機確認済み(ichiban-okinawa)。
 * 別店舗では folderId が異なるため、将来は settings 経由 or files/search で動的解決する。 */
export const RCABINET_FOLDER = {
  /** 商品画像(サムネ)フォルダ。公開URL: cabinet/thum02/{ne_code}.jpg */
  thum02: { path: "thum02", folderId: 10502933 },
  /** 白背景画像フォルダ。公開URL: cabinet/wb01/wb-{base}.jpg */
  wb01: { path: "wb01", folderId: 8266494 },
} as const;
