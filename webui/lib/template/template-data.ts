import { ProductInputSchema, type ProductInput } from "../product/schema";

/** 商品固有でテンプレートに含めない項目（流し込み時は空/デフォルトのまま）。
 * NEコード・JAN・商品名・価格は商品ごとに入力する（受入条件）。
 * モール識別子（rakuten_manage_number 等）・掲載状況・SKU一覧も別商品へ持ち越さない。
 * is_single / is_set は product_type からの派生項目なので保存しない。 */
export const TEMPLATE_EXCLUDED_FIELDS: readonly string[] = [
  "ne_code",
  "jan_code",
  "product_name",
  "display_name",
  "selling_price",
  "cost_price",
  "display_price",
  "variants",
  "rakuten_manage_number",
  "rakuten_variant_id",
  "shopify_product_id",
  "mall_listed",
  "yahoo_rewrite",
  "shopify_overrides",
  "is_single",
  "is_set",
];

const EXCLUDED = new Set(TEMPLATE_EXCLUDED_FIELDS);

/** ProductInput → 保存用 template_data（除外項目と派生項目を落とした plain object）。 */
export function productToTemplateData(p: ProductInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    if (EXCLUDED.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** template_data を空の新規商品(base)へ流し込む。除外項目は base の値を維持する。
 * 汚れた template_data（未知キー・ne_code 等の除外項目の混入）でも安全なように、
 * 除外項目を強制的に base 値で上書きしてから ProductInputSchema.parse で検証して返す
 * （未知キーは parse が落とし、is_single/is_set は product_type から再導出される）。 */
export function applyTemplateToProduct(
  templateData: Record<string, unknown>,
  base: ProductInput,
): ProductInput {
  const merged: Record<string, unknown> = { ...base, ...templateData };
  for (const key of TEMPLATE_EXCLUDED_FIELDS) {
    merged[key] = (base as unknown as Record<string, unknown>)[key];
  }
  return ProductInputSchema.parse(merged);
}
