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
  // 定期購入 — 楽天（260711修正依頼-5。楽天のみ patch 対象。他モールのビルダーでは skipped 扱い）
  "subscription_enabled",
  "subscription_shipping_date_flag",
  "subscription_interval_flag",
  "subscription_base_price",
  "subscription_first_price",
  // 定期購入 — Yahoo（260711修正依頼-Task7。yahoo-patch の OVERRIDE 対象。
  // 楽天の snapshot(parseRakutenItem) はこれらを返さないため楽天経路では比較対象外＝誤検知しない）
  "yahoo_subscription_type",
  "yahoo_subscription_price",
  "yahoo_subscription_group_index",
  "yahoo_subscription_recommended_cycle",
  "yahoo_subscription_point_code",
  // バリエーション軸（項目キー・項目名=ページの「タイプ:」表示）。楽天の items.patch では
  // 送れない（RAKUTEN_PATCHABLE 対象外→skipped 表示で「登録を使う」誘導）が、差分として
  // 見えないと「変えたのに変わらない」ように見えるため検出だけは行う（260720実件）。
  // 楽天以外は snapshot にこれらのキーが無ければ比較対象外＝誤検知しない（diffProduct の仕様）。
  "variation_key",
  "variation_name",
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
