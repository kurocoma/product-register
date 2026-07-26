import type { ProductInput } from "@/lib/product/schema";
import { productVariants, variantDisplayPrice } from "@/lib/product/schema";
import { fitFullWidth } from "@/lib/product/text-fit";
import type { Converter } from "./base";
import { ENCODING } from "./base";
import { buildYahooImgListHtml, buildYahooItemImageUrls } from "./image-url";
import { yahooTaxInclusive } from "./yahoo-tax";

export const YAHOO_COLUMNS = [
  "path", "name", "code", "sub-code", "original-price", "price", "sale-price", "member-price",
  "options", "headline", "caption", "abstract", "explanation", "additional1", "additional2", "additional3",
  "ship-weight", "taxable", "release-date", "point-code", "meta-desc", "sale-period-start", "sale-period-end", "sale-limit",
  "sp-code", "pr-rate", "brand-code", "product-code", "jan", "delivery", "condition", "product-category",
  "spec1", "spec2", "spec3", "spec4", "spec5", "spec6", "spec7", "spec8", "spec9", "spec10",
  "display", "sp-additional", "sort_priority",
  "original-price-evidence", "lead-time-instock", "lead-time-outstock", "keep-stock", "postage-set", "taxrate-type", "item-tag",
  "reserve-price", "reserve-sale-price", "reserve-member-price", "reserve-selling-period-start", "reserve-selling-period-end",
  "subscription-type", "subscription-price", "subscription-group-index", "subscription-recommended-cycle", "subscription-point-code",
  "video", "point-immediate", "eco-setting-id", "eco-setting-evidence-url",
  "grouping-id", "variation1-spec-id", "variation1-free-title", "variation1-name",
  "variation2-spec-id", "variation2-free-title", "variation2-name",
  "variation3-spec-id", "variation3-free-title", "variation3-name",
  "variation4-spec-id", "variation4-free-title", "variation4-name",
  "variation5-spec-id", "variation5-free-title", "variation5-name",
  "item-social-gift-type", "cross-border-agency-flag", "item-image-urls",
] as const;

function resolveGroupingId(neCode: string, enabled: boolean): string {
  if (!enabled) return "";
  const idx = neCode.lastIndexOf("-");
  if (idx === -1) return neCode;
  const suffix = neCode.slice(idx + 1);
  if (/^\d+$/.test(suffix)) return neCode.slice(0, idx);
  return neCode;
}

function buildVariationName(quantity: number, unit: string): string {
  return quantity === 1 ? `1${unit}` : `${quantity}${unit}セット`;
}

/** 商品オプション {name, values}[] → Yahoo options(自由文形式)文字列。
 *  形式: `name#v1,v2|name2#...`（最大20項目/各100値・name/value 全角28・
 *  使用不可文字(半角スペース/`<>;:&=#"\`/区切り `,|`)除去・合計20,000バイト以内）。 */
export function buildYahooOptions(opts: { name: string; values: string[] }[]): string {
  if (!Array.isArray(opts) || opts.length === 0) return "";
  // Yahoo の使用不可文字 + 構造区切り(, |)を除去（name/value とも）。
  const sanitize = (s: string) => fitFullWidth(s.replace(/[ \t<>;:&=#"\\,|]/g, ""), 28);
  const byteLen = (s: string) => new TextEncoder().encode(s).length;

  const parts: string[] = [];
  for (const o of opts.slice(0, 20)) {
    const name = sanitize(o.name);
    const values = o.values
      .map(sanitize)
      .filter((v) => v !== "")
      .slice(0, 100);
    if (name === "" || values.length === 0) continue;
    parts.push(`${name}#${values.join(",")}`);
  }
  let result = parts.join("|");
  // 合計20,000バイト超過時は末尾オプションから落とす。
  while (parts.length > 0 && byteLen(result) > 20000) {
    parts.pop();
    result = parts.join("|");
  }
  return result;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function toSingleQuotes(html: string): string {
  return html.replace(/"/g, "'");
}

function buildCaption(neCode: string, imageCount: number, descriptionPc: string): string {
  return buildYahooImgListHtml(neCode, imageCount) + toSingleQuotes(descriptionPc);
}

function buildExplanation(free1: string, descriptionPc: string): string {
  return stripHtml(free1 || descriptionPc);
}

export class YahooConverter implements Converter {
  mallName = "yahoo" as const;
  encoding = ENCODING.yahoo;

  convert(products: ProductInput[]): Record<string, string>[] {
    return products.map((p) => this.convertOne(p));
  }

  private convertOne(p: ProductInput): Record<string, string> {
    if (p.yahoo_grouping_enabled && !p.unit) {
      console.warn(`ne_code=${p.ne_code}: yahoo_grouping_enabled=true だが unit が空`);
    }
    // 多SKU商品は variants[0] を代表として従来どおり1行出力する
    // （設計書: Yahoo の多SKUは subcode_param で将来対応。フラット商品は1件合成=従来値）。
    const v = productVariants(p)[0];
    // selling_price / display_price は税抜（全モール統一）。Yahoo の price / original-price は税込のため
    // 送信時に税込へ変換する（取込側 parseYahooItem と対称。lib/converters/yahoo-tax.ts）。
    // 税率は商品レベル(p.tax_rate)が正（variant側は古い値が残ることがある。260715修正）。
    const taxInclusive = String(yahooTaxInclusive(v.selling_price, p.tax_rate));
    const displayInclusive = String(yahooTaxInclusive(variantDisplayPrice(p, v), p.tax_rate));
    const taxrateType = String(p.tax_rate / 100);
    const caption = buildCaption(v.ne_code, p.image_count, p.description_pc);
    const explanation = buildExplanation(p.free1, p.description_pc);
    const groupingId = resolveGroupingId(v.ne_code, p.yahoo_grouping_enabled);
    const variation1Title = p.yahoo_grouping_enabled ? p.yahoo_variation_title : "";
    const variation1Name = p.yahoo_grouping_enabled ? buildVariationName(v.quantity, p.unit) : "";
    const itemImageUrls = buildYahooItemImageUrls(v.ne_code, p.image_count);
    // 重量: 送料無料=100 / それ以外=1（運用ルール）。送料アイコン(delivery)も重量連動：
    // 100(=送料無料)なら 1(無料アイコン)、それ以外は 0(なし)。shipping_type は楽天 postageIncluded 由来。
    const shipWeight = v.shipping_type === "送料無料" ? "100" : "1";

    const row: Record<string, string> = Object.fromEntries(YAHOO_COLUMNS.map((c) => [c, ""]));
    Object.assign(row, {
      "path": p.yahoo_path,
      "name": p.display_name,
      "code": v.ne_code,
      "original-price": displayInclusive,
      "price": taxInclusive,
      "headline": p.catch_copy_yahoo,
      "caption": caption,
      "explanation": explanation,
      "options": buildYahooOptions(p.customization_options),
      "ship-weight": shipWeight,
      "taxable": "1",
      "jan": v.jan_code,
      "delivery": shipWeight === "100" ? "1" : "0",
      "condition": "0",
      "product-category": p.yahoo_category_id,
      "display": "1",
      "sp-additional": caption,
      "lead-time-instock": String(p.lead_time),
      "lead-time-outstock": String(p.lead_time),
      "keep-stock": "1",
      "postage-set": String(p.delivery_method),
      "taxrate-type": taxrateType,
      "grouping-id": groupingId,
      "variation1-free-title": variation1Title,
      "variation1-name": variation1Name,
      "item-image-urls": itemImageUrls,
    });

    // 定期購入（260711修正依頼-Task7。資料 yahoo-subscription-product-registration.md §5 の type 別ルール）:
    // - type=0（設定なし）は5列とも空のまま（CSV 既存出力と同一）。editItem での明示的な無効化
    //   （subscription_type=0 のみ送信）は buildYahooEditItemParams 側で行う。
    // - type=1/2 は price（アプリ内税抜 → 通常価格と同じ税込変換）・group を出力。
    //   cycle は設定時のみ、point は 1〜15 のみ（0=未設定は省略 — 送ると it-14126）。
    if (p.yahoo_subscription_type !== 0) {
      row["subscription-type"] = String(p.yahoo_subscription_type);
      row["subscription-price"] =
        p.yahoo_subscription_price > 0 ? String(yahooTaxInclusive(p.yahoo_subscription_price, p.tax_rate)) : "";
      row["subscription-group-index"] =
        p.yahoo_subscription_group_index > 0 ? String(p.yahoo_subscription_group_index) : "";
      row["subscription-recommended-cycle"] = p.yahoo_subscription_recommended_cycle;
      row["subscription-point-code"] =
        p.yahoo_subscription_point_code > 0 ? String(p.yahoo_subscription_point_code) : "";
    }
    return row;
  }
}
