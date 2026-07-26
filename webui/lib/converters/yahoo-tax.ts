/** Yahoo 価格の税変換ヘルパー（selling_price の税意味を全モール「税抜」に統一するための対）。
 *
 * Yahoo!ショッピング（ストアクリエイターPro）は「通常販売価格（税込）」＝税込で価格を登録・返却する。
 * 一方アプリの selling_price / display_price は全モール共通で税抜（楽天=税別登録・Shopify=送受信で変換済み）。
 * そのため Yahoo 経路では 送信時=税込へ / 取込時=税抜へ、必ずこの2関数の対で変換する。
 *
 * 丸め（2026-07-24 ユーザー裁定。旧: 四捨五入）: 消費税の慣行に合わせ税込は「切り捨て」。
 * 対称性の保証（幻差分・実価格ズレの防止）:
 *   yahooTaxExclusive(yahooTaxInclusive(x, r), r) === x
 *   切り捨て税込の逆変換は「切り上げ」で対にする: floor(x*(100+r)/100) は (x*(100+r)/100 - 1, x*(100+r)/100]
 *   の整数 → ×100/(100+r) は (x - 100/(100+r), x] の範囲 → ceil で必ず x に戻る（100/(100+r) < 1）。
 * 整数演算（分子を整数に保つ）で浮動小数点の誤差を避ける（§8 整数演算必須と同方針）。 */

/** 税抜 → 税込（Yahoo へ送る price / original_price 用）。税額は切り捨て。 */
export function yahooTaxInclusive(priceExclusive: number, taxRate: number): number {
  return Math.floor((priceExclusive * (100 + taxRate)) / 100);
}

/** 税込 → 税抜（Yahoo getItem の Price / OriginalPrice の取込用）。切り捨て税込の逆 = 切り上げ。 */
export function yahooTaxExclusive(priceInclusive: number, taxRate: number): number {
  return Math.ceil((priceInclusive * 100) / (100 + taxRate));
}

/** getItem の TaxrateType（float: 0.1=通常10% / 0.08=軽減8%。docs/Yahoo/02 §taxrate_type）を
 * アプリの tax_rate(8|10) へ変換する。未知値・空は undefined（呼び出し側のフォールバックに委ねる）。 */
export function taxRateFromTaxrateType(value: string): 8 | 10 | undefined {
  if (!value) return undefined;
  const n = Math.round(Number(value) * 100);
  if (n === 10) return 10;
  if (n === 8) return 8;
  return undefined;
}
