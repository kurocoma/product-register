import type { ProductInput } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";
import { rakutenVariantId } from "./rakuten-api";

/** 楽天 items.patch のボディ。変更されたフィールドだけを含む部分更新用。 */
export type RakutenPatchBody = Record<string, unknown>;

/** 楽天 PATCH で扱えるフィールド（Yahoo専用・画像は対象外）。 */
const RAKUTEN_PATCHABLE = new Set([
  "display_name",
  "mall_category_id",
  "catch_copy_pc",
  "description_pc",
  "description_sp",
  "selling_price",
  "jan_code",
  "shipping_type",
]);

/** 変更フィールド一覧 + 編集後 ProductInput から items.patch ボディを組み立てる。
 *
 * 設計上の注意:
 * - productDescription / variants.{id}.* のようなネストは、PATCH がオブジェクト単位で
 *   置換しても兄弟項目を失わないよう、変更時は編集後の「完全な」サブオブジェクトを送る。
 * - 価格・JAN・送料は variant（SKU管理番号 = rakuten_variant_id、無ければ ne_code）配下に入れる。
 *   ※ ここを ne_code 固定にすると、外部作成商品(variantキー≠NEコード)で別variant新規作成と誤認され
 *      IE0269/IE0229/IE0418 で失敗する。必ず実 variant キーを使う。
 * - 画像(image_count)・Yahoo専用項目はここでは扱わない（別フロー）。
 */
export function buildRakutenPatchBody(
  changed: ChangedField[],
  p: ProductInput,
  snapshot: Partial<ProductInput> = {},
): { body: RakutenPatchBody; variantId: string; skipped: string[] } {
  const fields = new Set(changed.map((c) => c.field));
  const skipped = changed.map((c) => c.field).filter((f) => !RAKUTEN_PATCHABLE.has(f));

  const body: RakutenPatchBody = {};
  const variantId = rakutenVariantId(p);
  const variant: Record<string, unknown> = {};

  // 必須・キー的な項目は空で送らない（空送信は楽天側でエラー/不正値になりうる）。
  if (fields.has("display_name") && p.display_name) body.title = p.display_name;
  if (fields.has("mall_category_id") && p.mall_category_id) body.genreId = p.mall_category_id;
  if (fields.has("catch_copy_pc")) body.tagline = p.catch_copy_pc;

  // productDescription は pc/sp の2項目を「オブジェクトごと」置換するため、両方を完全な値で送る。
  // 変更していない側はモール現状(snapshot)の値を使い、アプリ側の古い値で踏み潰さない。
  if (fields.has("description_pc") || fields.has("description_sp")) {
    body.productDescription = {
      pc: fields.has("description_pc") ? p.description_pc : (snapshot.description_pc ?? p.description_pc),
      sp: fields.has("description_sp") ? p.description_sp : (snapshot.description_sp ?? p.description_sp),
    };
  }

  if (fields.has("selling_price")) variant.standardPrice = String(p.selling_price);
  if (fields.has("jan_code")) {
    variant.articleNumber = /^\d{13}$/.test(p.jan_code)
      ? { value: p.jan_code }
      : { exemptionReason: 3 };
  }
  if (fields.has("shipping_type")) {
    variant.shipping = { postageIncluded: p.shipping_type === "送料無料" };
  }
  if (Object.keys(variant).length > 0) body.variants = { [variantId]: variant };

  return { body, variantId, skipped };
}
