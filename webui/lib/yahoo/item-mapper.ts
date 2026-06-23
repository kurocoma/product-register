import type { ProductInput } from "@/lib/product/schema";
import { YahooConverter } from "@/lib/converters/yahoo";

/** editItem に存在せず CSV 専用の列（送らない）。docs/Yahoo/02 で確認済み。 */
const CSV_ONLY = new Set(["pr-rate", "sort_priority"]);

/** editItem の必須 form パラメータ（seller_id を除く）。 */
export const YAHOO_REQUIRED = ["item_code", "path", "name", "product_category", "price"] as const;

/** CSV 列キー → editItem パラメータ名へ変換（ハイフン→アンダースコア、code→item_code）。 */
function toParamKey(csvKey: string): string {
  if (csvKey === "code") return "item_code";
  return csvKey.replace(/-/g, "_");
}

export type BuildEditItemOptions = {
  sellerId: string;
  /** 更新時 true。display を送らず既存の公開/非公開状態を保持する（誤公開防止）。 */
  forUpdate?: boolean;
  /** テスト用に display を明示指定（"0"=非公開）。forUpdate より優先。 */
  forceDisplay?: string;
};

/** ProductInput → editItem の form パラメータ。
 * フィールド値は既存 YahooConverter（CSVと同一ロジック・検証済み）を再利用して算出する。 */
export function buildYahooEditItemParams(
  p: ProductInput,
  opts: BuildEditItemOptions,
): Record<string, string> {
  const row = new YahooConverter().convert([p])[0];
  const params: Record<string, string> = { seller_id: opts.sellerId };

  for (const [csvKey, value] of Object.entries(row)) {
    if (CSV_ONLY.has(csvKey)) continue;
    if (value === "" || value == null) continue; // 空は送らない（既定値での意図しない上書きを避ける）
    params[toParamKey(csvKey)] = value;
  }

  // display の扱い: テスト指定 > 更新時は送らない > それ以外は CSV 値(公開=1)
  if (opts.forceDisplay !== undefined) {
    params.display = opts.forceDisplay;
  } else if (opts.forUpdate) {
    delete params.display;
  }

  return params;
}

/** 必須パラメータが揃っているか検証する。 */
export function validateEditItemParams(
  params: Record<string, string>,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = YAHOO_REQUIRED.filter((k) => !params[k]);
  if (!params.seller_id) missing.unshift("seller_id");
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
