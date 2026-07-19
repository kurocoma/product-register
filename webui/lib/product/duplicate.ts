/** 商品複製（アウトレット品作成用・260720機能追加）。
 * 識別子（NEコード・楽天管理番号）だけ差し替え、残りの項目はそのままコピーする。
 * 原本のモール商品を誤って上書きしないよう、モール連携キーは必ずリセットする:
 * - mall_listed（掲載記録）→ {}（未掲載。一覧の「反映」ボタンを誤爆させない）
 * - shopify_product_id（Shopify 冪等キー）→ ""
 * - rakuten_variant_id（楽天 SKU キー。SKU管理番号は店舗内一意）→ ""
 * Yahoo は item_code = NEコードのため、新NEコードで自動的に別商品になる。
 * 多SKUの variants はそのままコピーする（SKUコードの変更は複製後に SKU一覧で行う）。 */
import { ProductInputSchema, type ProductInput } from "./schema";

export function duplicateProductInput(
  original: ProductInput,
  opts: { ne_code: string; rakuten_manage_number?: string },
): ProductInput {
  const neCode = opts.ne_code.trim();
  if (!neCode) throw new Error("新しいNEコードを入力してください");
  if (neCode === original.ne_code) {
    throw new Error("元の商品と同じNEコードには複製できません。別のNEコードを入力してください");
  }
  return ProductInputSchema.parse({
    ...original,
    ne_code: neCode,
    rakuten_manage_number: opts.rakuten_manage_number?.trim() ?? "",
    mall_listed: {},
    shopify_product_id: "",
    rakuten_variant_id: "",
  });
}
