import type { ProductInput } from "@/lib/product";
import { pruneEmptyVariants } from "@/lib/product";
import { rakutenGross, yahooTaxInclusive, variantKey } from "@/lib/converters";
import type { BulkFieldChange } from "./types";

/** JAN売価変更（機能1）の純ロジック。
 *
 * JAN（13桁・複数）→ 商品(products.jan_code) と SKU(variants[].jan_code) の一致で
 * 単品＋セットを抽出し、SKU行単位で新税抜価格を入力 → 適用する。
 * 税込換算はモールごとの正規実装（楽天=rakutenGross 切り捨て / Yahoo=yahooTaxInclusive 切り捨て）。
 */

/** RMS 登録価格の上限（rakuten-tax.ts の MAX_UNIT_NET と同値）。 */
export const JAN_PRICE_MAX_NET = 999_999_999;

/** JAN 貼り付け入力（改行/カンマ/CSV1列）を 13桁で valid/invalid に分類する純関数。 */
export function parseJanCodes(input: string | string[]): {
  valid: string[];
  invalid: { raw: string; reason: string }[];
  duplicatesRemoved: number;
} {
  const sources = Array.isArray(input) ? input : [input];
  const tokens: string[] = [];
  for (const s of sources) {
    for (const part of String(s).split(/[\r\n,]+/)) {
      const t = part.trim();
      if (t) tokens.push(t);
    }
  }
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  const valid: string[] = [];
  const invalid: { raw: string; reason: string }[] = [];
  for (const t of tokens) {
    if (seen.has(t)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(t);
    if (/^\d{13}$/.test(t)) valid.push(t);
    else invalid.push({ raw: t, reason: "JANコードは13桁の数字で入力してください" });
  }
  return { valid, invalid, duplicatesRemoved };
}

/** 一覧グリッドの1行（フラット商品=1行 / 多SKU商品=SKUごとに1行）。 */
export type JanPriceRow = {
  productId: string;
  /** 表示用管理番号（rakuten_manage_number 優先、無ければ NEコード） */
  key: string;
  title: string;
  productType: string;
  /** SKU行の実キー（SKU管理番号/NEコード）。フラット商品は ""（商品レベル価格） */
  variantKey: string;
  variationLabel: string;
  jan: string;
  /** 入力した JAN に一致した行か（セット等で同一JANを持つ行の目印） */
  matched: boolean;
  taxRate: 8 | 10;
  currentNet: number;
  currentRakutenGross: number;
  currentYahooGross: number;
  newNet?: number;
  newRakutenGross?: number;
  newYahooGross?: number;
};

/** 価格編集（グリッドの新税抜価格入力）。variantKey "" = フラット商品の商品レベル価格。 */
export type JanPriceEdit = { productId: string; variantKey: string; newNet: number };

export function janPriceRowKeyOf(productId: string, vKey: string): string {
  return `${productId}|${vKey}`;
}

/** 商品1件 → グリッド行（多SKUは SKU 行で表示・編集）。
 * 税率は商品レベルを正とする（variant 側は古い値が残ることがある。yahoo-split.ts と同じ裁定）。 */
export function buildJanPriceRows(
  productId: string,
  key: string,
  p: ProductInput,
  jans: ReadonlySet<string>,
  edits: ReadonlyMap<string, number>,
): JanPriceRow[] {
  const taxRate = p.tax_rate;
  const rows: JanPriceRow[] = [];
  const push = (vKey: string, jan: string, net: number, variationLabel: string) => {
    const newNet = edits.get(janPriceRowKeyOf(productId, vKey));
    const row: JanPriceRow = {
      productId,
      key,
      title: p.display_name || p.product_name,
      productType: p.product_type,
      variantKey: vKey,
      variationLabel,
      jan,
      matched: jans.has(jan),
      taxRate,
      currentNet: net,
      currentRakutenGross: rakutenGross(net, taxRate),
      currentYahooGross: yahooTaxInclusive(net, taxRate),
    };
    if (newNet != null && Number.isInteger(newNet) && newNet >= 1 && newNet <= JAN_PRICE_MAX_NET) {
      row.newNet = newNet;
      row.newRakutenGross = rakutenGross(newNet, taxRate);
      row.newYahooGross = yahooTaxInclusive(newNet, taxRate);
    }
    rows.push(row);
  };
  const real = pruneEmptyVariants(p.variants ?? []);
  if (real.length === 0) {
    push("", p.jan_code, p.selling_price, "");
  } else {
    for (const v of real) push(variantKey(v), v.jan_code, v.selling_price, v.variation_value);
  }
  return rows;
}

/** 価格編集を ProductInput へ適用する（価格未入力の行は変更なし＝スキップ）。 */
export function applyJanPriceEdits(
  productId: string,
  p: ProductInput,
  edits: JanPriceEdit[],
): { mutated: ProductInput; changes: BulkFieldChange[]; errors: string[] } {
  const mine = edits.filter((e) => e.productId === productId);
  const changes: BulkFieldChange[] = [];
  const errors: string[] = [];
  const real = pruneEmptyVariants(p.variants ?? []);
  const mutated: ProductInput = { ...p, variants: [...(p.variants ?? [])] };
  for (const e of mine) {
    if (!Number.isInteger(e.newNet) || e.newNet < 1 || e.newNet > JAN_PRICE_MAX_NET) {
      errors.push(`新価格が不正です（${e.variantKey || "商品"}: ${e.newNet}）。1〜${JAN_PRICE_MAX_NET} の整数で入力してください`);
      continue;
    }
    if (e.variantKey === "") {
      if (real.length > 0) {
        errors.push("多SKU商品は SKU 行で価格を指定してください");
        continue;
      }
      if (mutated.selling_price !== e.newNet) {
        changes.push({ field: "selling_price", before: p.selling_price, after: e.newNet });
        mutated.selling_price = e.newNet;
      }
      continue;
    }
    const idx = mutated.variants.findIndex((v) => variantKey(v) === e.variantKey);
    if (idx < 0) {
      errors.push(`SKU「${e.variantKey}」が商品に見つかりません`);
      continue;
    }
    const v = mutated.variants[idx];
    if (v.selling_price !== e.newNet) {
      changes.push({ field: "selling_price", variantKey: e.variantKey, before: v.selling_price, after: e.newNet });
      mutated.variants[idx] = { ...v, selling_price: e.newNet };
    }
  }
  return { mutated, changes, errors };
}
