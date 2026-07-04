import type { ProductInput } from "./schema";

/** 統合商品（variants[] が2件以上）を Yahoo 向けに「SKUごとの擬似商品」へ展開する。
 *
 * ユーザー要件「楽天はバリエーションキーで1商品に統合するが、Yahoo は分ける」の単一実装。
 * Yahoo の CSV 出力・登録（editItem）は従来どおり SKU ごとに別商品
 * （item_code = 各SKUのNEコード）にするため、CSVルート・Yahoo登録サービスの
 * ユーザー向け呼び出し口は変換前にこのヘルパで展開する。
 *
 * - SKU固有の項目: ne_code / jan_code / 販売価格 / 表示価格 / 税率 / 数量 / 送料区分 / 属性
 * - 商品ページ共通の項目: 商品名・説明・画像・カテゴリ・Yahoo grouping
 *   （yahoo_grouping_enabled / unit / yahoo_variation_title）などは商品側の値を引き継ぐ
 * - 展開後は variants を空にする（= フラット商品と同形）。YahooConverter /
 *   buildYahooEditItemParams は従来のフラット経路をそのまま通る。
 *
 * 既定挙動は変えない opt-in ヘルパ: YahooConverter に統合商品を直接渡したときの
 * 「variants[0] 代表で1行」は従来仕様のまま（yahoo-csv-multisku.test.ts で固定）。
 * フラット商品・variants 1件の商品は展開せず [p] をそのまま返す。 */
export function yahooItemsForProduct(p: ProductInput): ProductInput[] {
  if (!p.variants || p.variants.length < 2) return [p];
  return p.variants.map((v) => ({
    ...p,
    ne_code: v.ne_code,
    jan_code: v.jan_code,
    selling_price: v.selling_price,
    // SKU別の表示価格（二重価格）。未設定なら 0 = 販売価格連動（フラット商品と同じ規則）
    display_price: v.display_price && v.display_price > 0 ? v.display_price : 0,
    tax_rate: v.tax_rate,
    quantity: v.quantity,
    shipping_type: v.shipping_type,
    product_type: v.quantity === 1 ? ("単品" as const) : ("セット商品" as const),
    is_single: v.quantity === 1,
    is_set: v.quantity !== 1,
    rakuten_variant_id: v.sku_manage_number || v.ne_code,
    // 属性は SKU 側にあれば SKU の値、無ければ商品共通の値を使う
    attributes: v.attributes && v.attributes.length > 0 ? v.attributes : p.attributes,
    variants: [],
  }));
}
