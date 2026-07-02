/** モール登録検証の missing フィールド名 → 運用者向け日本語ラベルの単一源泉。
 * 源泉フィールド名は 楽天 validateUpsertBody（lib/converters/rakuten-api.ts）と
 * Yahoo validateEditItemParams（lib/yahoo/item-mapper.ts）が返す値。
 * API レスポンスの missing[] は原名のまま保ち、表示側（BulkRegisterPanel 等）だけで変換する。
 * 文言は NewProductChecklist（lib/product/new-product-checklist.ts）・ProductForm のラベルに
 * 合わせ、チェックリストと一括確認テーブルで文言が食い違わないようにする。 */

export const MISSING_FIELD_LABELS: Record<string, string> = {
  // --- 楽天 validateUpsertBody 系 ---
  "manageNumber(英数-_)": "商品管理番号（半角英数と - _ のみ）",
  title: "掲載商品名（モール用）",
  itemType: "商品タイプ",
  "genreId(6桁)": "楽天ジャンルID（6桁）",
  variants: "SKU（バリエーション）情報",
  "variants.standardPrice": "SKUの販売価格",
  // --- Yahoo validateEditItemParams 系 ---
  seller_id: "Yahooストアアカウント（seller_id 設定）",
  item_code: "商品コード（NEコード）",
  path: "Yahooカテゴリ（パス）",
  name: "掲載商品名（モール用）",
  product_category: "YahooカテゴリID",
  price: "販売価格",
  // --- Yahoo 文字数検証（validateYahooFieldLimits）の動的メッセージ先頭に付くフィールド名 ---
  headline: "キャッチコピー（Yahoo）",
  caption: "商品説明（PC）",
  sp_additional: "商品説明（スマホ用）",
};

/** missing 1件を運用者向け日本語へ変換する。
 * - 完全一致（例: "genreId(6桁)"）はラベルへ置換。
 * - 「price が範囲外（…）」「name が空です」のような動的メッセージは先頭のフィールド名だけ
 *   ラベル化し、続きの説明はそのまま残す（例: 「販売価格が範囲外（…）」）。
 * - 未知のフィールドは原名のまま返す（誤った意訳よりも安全側）。 */
export function missingFieldLabel(field: string): string {
  const exact = MISSING_FIELD_LABELS[field];
  if (exact) return exact;
  const m = field.match(/^(\S+) (.+)$/);
  if (m) {
    const head = MISSING_FIELD_LABELS[m[1]];
    if (head) return `${head}${m[2]}`;
  }
  return field;
}

/** missing 全件を変換する（BulkRegisterPanel の確認結果テーブル表示用）。 */
export function missingFieldLabels(missing: string[]): string[] {
  return missing.map(missingFieldLabel);
}
