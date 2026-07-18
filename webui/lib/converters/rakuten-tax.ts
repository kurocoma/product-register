/** 楽天 実ページ表示の税込換算（selling_price は全モール税抜統一）。
 *
 * 当店（ichiban-okinawa）の楽天商品は税別で登録されており（items.get の standardPrice = 税抜値）、
 * 実ページの税込表示は RMS の店舗税設定どおり「切り捨て」で計算される
 * （実測: r7201-1 税抜3,912 × 1.08 = 4,224.96 → 実ページ 4,224円）。
 * Yahoo（四捨五入 yahooTaxInclusive）・Shopify（Math.round priceWithTax）とは丸めが異なるので共用しない。 */
export function rakutenTaxInclusive(priceExclusive: number, taxRate: number): number {
  return Math.floor(priceExclusive * (1 + taxRate / 100));
}
