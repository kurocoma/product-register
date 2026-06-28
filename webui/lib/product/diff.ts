import type { ProductInput } from "@/lib/product/schema";

/** 部分更新で扱う編集対象フィールド（snapshot と比較する対象）。 */
export const EDITABLE_FIELDS: (keyof ProductInput)[] = [
  "display_name",
  "selling_price",
  "display_price",
  "description_pc",
  "description_sp",
  "catch_copy_pc",
  "catch_copy_yahoo",
  "mall_category_id",
  "yahoo_category_id",
  "jan_code",
  "shipping_type",
  // 画像(image_count)は本フローの差分対象外。画像差し替えは ImageUploadPanel + 登録で行う。
];

export type ChangedField = { field: string; before: unknown; after: unknown };

/** 取得スナップショットと編集後を比較し、変更されたフィールドだけを返す。
 * snapshot に値が無い（取得できなかった）フィールドは比較対象外にして誤検知を防ぐ。 */
export function diffProduct(
  snapshot: Partial<ProductInput>,
  edited: ProductInput,
  fields: (keyof ProductInput)[] = EDITABLE_FIELDS,
): ChangedField[] {
  const changed: ChangedField[] = [];
  for (const f of fields) {
    if (!(f in snapshot)) continue; // 取得できていない項目は差分判定しない
    const before = snapshot[f];
    const after = edited[f];
    if (before !== after) changed.push({ field: f as string, before, after });
  }
  return changed;
}
