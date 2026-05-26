import type { ProductInput } from "@/lib/product/schema";
import type { Converter } from "./base";
import { ENCODING } from "./base";
import { buildYahooImgListHtml, buildYahooItemImageUrls } from "./image-url";

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
    const taxInclusive = String(Math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5));
    const taxrateType = String(p.tax_rate / 100);
    const caption = buildCaption(p.ne_code, p.image_count, p.description_pc);
    const explanation = buildExplanation(p.free1, p.description_pc);
    const groupingId = resolveGroupingId(p.ne_code, p.yahoo_grouping_enabled);
    const variation1Title = p.yahoo_grouping_enabled ? p.yahoo_variation_title : "";
    const variation1Name = p.yahoo_grouping_enabled ? buildVariationName(p.quantity, p.unit) : "";
    const itemImageUrls = buildYahooItemImageUrls(p.ne_code, p.image_count);

    const row: Record<string, string> = Object.fromEntries(YAHOO_COLUMNS.map((c) => [c, ""]));
    Object.assign(row, {
      "path": p.yahoo_path,
      "name": p.display_name,
      "code": p.ne_code,
      "original-price": taxInclusive,
      "price": taxInclusive,
      "headline": p.catch_copy_yahoo,
      "caption": caption,
      "explanation": explanation,
      "ship-weight": "1",
      "taxable": "1",
      "jan": p.jan_code,
      "delivery": "0",
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
    return row;
  }
}
