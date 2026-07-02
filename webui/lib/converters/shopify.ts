import type { ProductInput, Variant } from "@/lib/product/schema";
import { productVariants } from "@/lib/product/schema";
import type { Converter } from "./base";
import { ENCODING } from "./base";

export const SHOPIFY_CDN_BASE = "https://cdn.shopify.com/s/files/1/0602/0992/2282/files/";
const SITE_NAME = "【くりま】沖縄県産品・特産品の通販サイト";
const SEO_DESC_SUFFIX =
  "のことなら沖縄県産品・特産品の通販サイトくりま。沖縄から全国一律9800円以上購入で送料無料！単品購入で送料無料も多数。";

export const SHOPIFY_COLUMNS = [
  "Handle", "Image Src", "Image Position", "Title", "Body (HTML)", "Vendor",
  "Product Category", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option1 Linked To",
  "Option2 Name", "Option2 Value", "Option2 Linked To",
  "Option3 Name", "Option3 Value", "Option3 Linked To",
  "Variant SKU", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price",
  "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Variant Barcode",
  "Image Alt Text", "Gift Card", "SEO Title", "SEO Description",
  "Google Shopping / Google Product Category", "Google Shopping / Gender",
  "Google Shopping / Age Group", "Google Shopping / MPN", "Google Shopping / Condition",
  "Google Shopping / Custom Product",
  "Google Shopping / Custom Label 0", "Google Shopping / Custom Label 1",
  "Google Shopping / Custom Label 2", "Google Shopping / Custom Label 3",
  "Google Shopping / Custom Label 4",
  "Google: Custom Product (product.metafields.mm-google-shopping.custom_product)",
  "送料 (product.metafields.my_fields._0000)",
  "商品評価数 (product.metafields.reviews.rating_count)",
  "国 (product.metafields.shopify.country)",
  "Variant Image", "Variant Weight Unit", "Variant Tax Code", "Cost per item",
  "Included / 日本", "Price / 日本", "Compare At Price / 日本",
  "Included / 国際", "Price / 国際", "Compare At Price / 国際",
  "Status",
] as const;

function baseCodeOf(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

function priceWithTax(p: { selling_price: number; tax_rate: number }): number {
  return Math.round(p.selling_price * (1 + p.tax_rate / 100));
}

/** 1 SKU 行の元データ。多SKU商品は variants[] を展開し、フラット商品は1件合成（後方互換）。 */
type SkuSlot = { p: ProductInput; v: Variant };

function generateImageUrl(base: string, position: number): string {
  if (position === 1) return `${SHOPIFY_CDN_BASE}${base}-1.jpg`;
  return `${SHOPIFY_CDN_BASE}${base}_${position}.jpg`;
}

function getOption1Value(p: ProductInput): string {
  if (!p.variation_choices) return "";
  const suffix = p.ne_code.split("-").slice(-1)[0];
  const choices = p.variation_choices.split("|").map((c) => c.trim());
  let matched: string | null = null;
  for (const choice of choices) {
    const digits = choice.replace(/[^0-9]/g, "");
    if (digits === suffix) {
      matched = choice;
      break;
    }
  }
  if (matched === null) matched = choices[0] || "";
  if (p.shipping_type === "送料無料") return `${matched}(送料無料)`;
  return matched;
}

function addTableClass(html: string): string {
  return html.replace(/<table\s[^>]*>/g, (tag) => {
    if (tag.includes("class=")) return tag;
    return tag.replace("<table ", '<table class="itemtable" ');
  });
}

export function buildShopifyBodyHtml(base: string, imageCount: number, descriptionPc: string): string {
  let imgTags = "";
  for (let i = 2; i <= imageCount; i++) {
    imgTags += `<img src="${SHOPIFY_CDN_BASE}${base}_${i}.jpg" width="100%"><br>`;
  }
  const processed = addTableClass(descriptionPc);
  return `<!--imgList-->${imgTags}<!--/imgList-->\n${processed}`;
}

export class ShopifyConverter implements Converter {
  mallName = "shopify" as const;
  encoding = ENCODING.shopify;

  convert(products: ProductInput[]): Record<string, string>[] {
    const groups = new Map<string, ProductInput[]>();
    for (const p of products) {
      const b = baseCodeOf(p);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(p);
    }

    const rows: Record<string, string>[] = [];
    for (const base of Array.from(groups.keys()).sort()) {
      const members = groups.get(base)!;
      rows.push(...this.expandGroup(base, members));
    }
    return rows;
  }

  private expandGroup(base: string, members: ProductInput[]): Record<string, string>[] {
    const rep = members.find((p) => p.is_single) ?? members[0];
    // 各商品の variants[] を SKU スロット列に展開（フラット商品は1件合成 → 従来の members と同数）。
    const skus: SkuSlot[] = members.flatMap((p) => productVariants(p).map((v) => ({ p, v })));
    const maxImages = Math.max(...members.map((p) => p.image_count));
    // SKU 数が画像数を超えても SKU 行を落とさない。
    const rowCount = Math.max(maxImages, skus.length);
    const rows: Record<string, string>[] = [];

    for (let pos = 1; pos <= rowCount; pos++) {
      const imageUrl = pos <= maxImages ? generateImageUrl(base, pos) : "";
      if (pos === 1) {
        rows.push(this.buildFirstRow(base, rep, skus[0], imageUrl, skus.length));
      } else if (pos - 1 < skus.length) {
        rows.push(this.buildVariantRow(base, skus[pos - 1], imageUrl, pos));
      } else {
        rows.push(this.buildImageOnlyRow(base, imageUrl, pos));
      }
    }
    return rows;
  }

  private emptyRow(handle: string): Record<string, string> {
    const row: Record<string, string> = Object.fromEntries(SHOPIFY_COLUMNS.map((c) => [c, ""]));
    row["Handle"] = handle;
    return row;
  }

  private fillVariantFields(row: Record<string, string>, { p, v }: SkuSlot): void {
    // variation_value を持つ variant はそれを選択肢ラベルに（送料無料は接尾辞付き）。
    // フラット商品の合成 variant は variation_value 空 → 従来の getOption1Value(p) にフォールバック。
    row["Option1 Value"] = v.variation_value
      ? v.shipping_type === "送料無料"
        ? `${v.variation_value}(送料無料)`
        : v.variation_value
      : getOption1Value(p);
    row["Variant SKU"] = v.ne_code;
    row["Variant Grams"] = "0.0";
    row["Variant Inventory Tracker"] = "shopify";
    row["Variant Inventory Qty"] = "0";
    row["Variant Inventory Policy"] = "deny";
    row["Variant Fulfillment Service"] = "manual";
    row["Variant Price"] = String(priceWithTax(v));
    row["Variant Requires Shipping"] = "true";
    row["Variant Taxable"] = "true";
    row["Variant Barcode"] = v.jan_code;
    row["Variant Image"] = `${SHOPIFY_CDN_BASE}${v.ne_code}.jpg`;
  }

  private buildFirstRow(
    base: string,
    rep: ProductInput,
    firstVariant: SkuSlot,
    imageUrl: string,
    skuCount: number,
  ): Record<string, string> {
    const row = this.emptyRow(base);
    row["Title"] = rep.display_name;
    row["Body (HTML)"] = buildShopifyBodyHtml(base, rep.image_count, rep.description_pc);
    row["Vendor"] = `${rep.maker_name}<br>商品コード:${base}`;
    row["Tags"] = `${rep.maker_name},税率${rep.tax_rate}%`;
    row["Published"] = "true";
    // 多SKU(2件以上)は variation_name 未定義でもセレクタ名を出す（Shopify は複数variantにオプション名必須）。
    row["Option1 Name"] = rep.variation_name || skuCount > 1 ? "セット数を選んでください" : "Title";
    row["Gift Card"] = "false";
    row["SEO Title"] = `${rep.product_name}|${SITE_NAME}`;
    row["SEO Description"] = `${rep.product_name}${SEO_DESC_SUFFIX}`;
    row["Included / 日本"] = "true";
    row["Included / 国際"] = "true";
    row["Status"] = "active";
    row["Image Src"] = imageUrl;
    row["Image Position"] = "1";
    this.fillVariantFields(row, firstVariant);
    row["Variant Weight Unit"] = "kg";
    return row;
  }

  private buildVariantRow(
    base: string,
    sku: SkuSlot,
    imageUrl: string,
    position: number,
  ): Record<string, string> {
    const row = this.emptyRow(base);
    row["Image Src"] = imageUrl;
    row["Image Position"] = imageUrl ? String(position) : "";
    this.fillVariantFields(row, sku);
    return row;
  }

  private buildImageOnlyRow(
    base: string,
    imageUrl: string,
    position: number,
  ): Record<string, string> {
    const row = this.emptyRow(base);
    row["Image Src"] = imageUrl;
    row["Image Position"] = String(position);
    return row;
  }
}
