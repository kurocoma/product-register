/** 楽天店舗・R-Cabinet 関連の共有定数。
 * 店舗名(ichiban-okinawa)が変換器・プレビュー・アップロードに散在しないよう一元化する。 */

export const DEFAULT_RAKUTEN_STORE = "ichiban-okinawa";

/** RMS（楽天の店舗管理画面）メインメニューURL。管理番号が無い（未掲載）商品の遷移先。 */
export const RAKUTEN_RMS_URL = "https://mainmenu.rms.rakuten.co.jp/";

/** RMS 商品編集ページURLの shops/{id} 部分（当店の RMS 店舗ID。実URLから確認・260720）。 */
export const RAKUTEN_RMS_SHOP_ID = "235545";

/** RMS の商品別編集ページURL（SKU移行後の新エディタ）。管理番号が未設定なら null。
 * 形式は実URLで確認済み: https://item.rms.rakuten.co.jp/rms-sku/shops/235545/item/edit/r122-1 （260720依頼） */
export function rakutenRmsItemEditUrl(shopId: string, manageNumber: string | null | undefined): string | null {
  const mn = (manageNumber ?? "").trim();
  return mn ? `https://item.rms.rakuten.co.jp/rms-sku/shops/${shopId}/item/edit/${encodeURIComponent(mn)}` : null;
}

/** 楽天の公開商品ページURL。管理番号が未設定（未掲載）なら null。
 * 例: rakutenItemPageUrl("ichiban-okinawa", "t002-2542") → "https://item.rakuten.co.jp/ichiban-okinawa/t002-2542/" */
export function rakutenItemPageUrl(store: string, manageNumber: string | null | undefined): string | null {
  const mn = (manageNumber ?? "").trim();
  return mn ? `https://item.rakuten.co.jp/${store}/${encodeURIComponent(mn)}/` : null;
}

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
