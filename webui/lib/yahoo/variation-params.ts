/** Yahoo 1ページ統合バリエーション（options + subcodes + subcode_param）のパラメータ生成。
 *
 * yahoo_variation_mode === "unified" の商品（variants 2件以上・各SKUに variation_value あり）を
 * Yahoo の正規バリエーション形式で1商品として登録するための editItem 追加パラメータを組み立てる。
 * 形式（editItem 公式仕様で確認済み・2026-07）:
 *  - options:       {軸名}#{値1},{値2}|{別オプション名}#{値...}   （選択肢の定義。既存の項目選択肢と連結）
 *  - subcodes:      {軸名}:{値}={サブコード}|...                  （組合せ→個別商品コード。最大100）
 *  - subcode_param: {サブコード}=price:{税込価格}|...             （SKU別価格。最高値が通常価格を上書き）
 * 在庫は setStock の item_code に "{親コード}:{サブコード}" を渡して個別設定する。 */
import type { ProductInput } from "@/lib/product/schema";
import { yahooTaxInclusive } from "@/lib/converters/yahoo-tax";

export type YahooVariationParams = {
  options: string;
  subcodes: string;
  subcode_param?: string;
  /** setStock 用のサブコード一覧（"{親}:{sub}" を組み立てる材料） */
  subCodeList: string[];
};

export type YahooVariationResult =
  | { ok: true; params: YahooVariationParams }
  | { ok: false; error: string }
  | { ok: false; skip: true };

/** options/subcodes のフォーマット区切り文字（# | , : = ）を含む値は表現できないため拒否する。 */
const FORBIDDEN = /[#|,:=]/;

function invalid(label: string, value: string): string | null {
  if (!value.trim()) return `${label}が空です`;
  if (FORBIDDEN.test(value)) return `${label}「${value}」に使用できない文字（# | , : =）が含まれています`;
  return null;
}

/** unified 対象かどうか（判定のみ・エラーは出さない）。 */
export function isUnifiedVariationTarget(p: ProductInput): boolean {
  return p.yahoo_variation_mode === "unified" && (p.variants?.length ?? 0) >= 2;
}

export function buildYahooVariationParams(p: ProductInput): YahooVariationResult {
  if (!isUnifiedVariationTarget(p)) return { ok: false, skip: true };

  // 軸名: バリエーション項目名 → 項目キー → grouping タイトルの順で採用
  const axis = (p.variation_name || p.variation_key || p.yahoo_variation_title || "タイプ").trim();
  const axisErr = invalid("バリエーション項目名", axis);
  if (axisErr) return { ok: false, error: axisErr };

  const values: string[] = [];
  const subcodePairs: string[] = [];
  const subCodeList: string[] = [];
  const seenValue = new Set<string>();
  const seenSub = new Set<string>();
  for (const v of p.variants) {
    const label = (v.variation_value || "").trim();
    const err = invalid(`バリエーション選択肢（SKU ${v.ne_code}）`, label);
    if (err) return { ok: false, error: err + "。SKU一覧の「バリエーション」列を確認してください" };
    if (seenValue.has(label)) return { ok: false, error: `バリエーション選択肢「${label}」が重複しています` };
    seenValue.add(label);

    const sub = v.ne_code.trim();
    if (!/^[A-Za-z0-9-]{1,99}$/.test(sub)) {
      return { ok: false, error: `サブコード「${sub}」が不正です（半角英数字とハイフン・99文字以内）` };
    }
    if (seenSub.has(sub)) return { ok: false, error: `サブコード「${sub}」が重複しています` };
    seenSub.add(sub);

    values.push(label);
    subcodePairs.push(`${axis}:${label}=${sub}`);
    subCodeList.push(sub);
  }
  if (values.length > 100) return { ok: false, error: "サブコードは最大100個までです" };

  // options: バリエーション軸 + 既存の項目選択肢（customization_options）を連結
  const optionParts = [`${axis}#${values.join(",")}`];
  for (const o of p.customization_options ?? []) {
    const nameErr = invalid(`項目選択肢名「${o.name}」`, o.name);
    if (nameErr) continue; // 表現できない項目選択肢は options から除外（バリエーション登録は妨げない）
    const vals = o.values.filter((x) => x.trim() && !FORBIDDEN.test(x));
    if (vals.length > 0) optionParts.push(`${o.name}#${vals.join(",")}`);
  }

  // subcode_param: SKU 間で税込価格が異なる場合のみ、全SKUへ price を付ける
  // （Yahoo 仕様: 個別価格の最高値が通常販売価格を上書きするため、付けるなら全SKU一律に付けて明示する）
  const prices = p.variants.map((v) => yahooTaxInclusive(v.selling_price, v.tax_rate));
  const allSame = prices.every((x) => x === prices[0]);
  const subcodeParam = allSame
    ? undefined
    : p.variants.map((v, i) => `${v.ne_code.trim()}=price:${prices[i]}`).join("|");

  return {
    ok: true,
    params: {
      options: optionParts.join("|"),
      subcodes: subcodePairs.join("|"),
      ...(subcodeParam ? { subcode_param: subcodeParam } : {}),
      subCodeList,
    },
  };
}
