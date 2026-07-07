/** Shopify product query の JSON から、編集対象になる項目を ProductInput 部分へパースする。
 * （API 用。CSV エクスポートの shopify.ts とは別モジュール — docs/shopify/08 §5-1 命名注意）
 *
 * 価格の規約: Shopify は税込・アプリは税抜（CSV コンバータ priceWithTax と同一式の逆算）。
 * tax_rate は本アプリ登録商品のタグ「税率N%」（shopify.ts の Tags 規約）から復元し、
 * 無ければ opts.taxRate → 10 に倒す。 */
import { VariantSchema, type ProductInput, type Variant } from "@/lib/product/schema";
import type { ShopifyProductNode, ShopifyVariantNode } from "@/lib/shopify/product-client";

/** Body(HTML) 先頭の画像ブロック <!--imgList-->...<!--/imgList--> を除いた本文を返す。
 * ブロックが無い（外部作成商品）場合は全文をそのまま返す。 */
export function stripImgList(html: string): string {
  return html.replace(/^<!--imgList-->[\s\S]*?<!--\/imgList-->\r?\n?/, "");
}

/** Body(HTML) 先頭の画像ブロックを取り出す（無ければ ""）。部分更新時に画像タグを保持する用。 */
export function extractImgList(html: string): string {
  const m = html.match(/^<!--imgList-->[\s\S]*?<!--\/imgList-->/);
  return m ? m[0] : "";
}

/** タグ「税率8%」「税率10%」から税率を復元する（shopify.ts の Tags 出力規約）。 */
export function taxRateFromTags(tags: string[]): 8 | 10 | undefined {
  for (const t of tags) {
    const m = t.trim().match(/^税率(\d+)%$/);
    if (m) {
      const n = Number(m[1]);
      if (n === 8) return 8;
      if (n === 10) return 10;
    }
  }
  return undefined;
}

/** Shopify 税込価格文字列 → アプリ税抜整数円（Money は "540" / "540.00" の両表記に対応）。 */
export function taxExcludedPrice(money: string | null | undefined, taxRate: number): number {
  const n = Number(money ?? "");
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / (1 + taxRate / 100));
}

function normalizeJan(barcode: string | null | undefined): string {
  const t = (barcode ?? "").trim();
  return /^\d{13}$/.test(t) ? t : "";
}

/** Shopify variant → アプリ Variant。SKU 照合キーは ne_code ↔ variant.sku
 * （CSV 登録規約: Variant SKU = ne_code。sku_manage_number は楽天キーなので使わない）。 */
function toAppVariant(sv: ShopifyVariantNode, taxRate: number): Variant {
  return VariantSchema.parse({
    sku_manage_number: "",
    ne_code: sv.sku,
    jan_code: normalizeJan(sv.barcode),
    selling_price: taxExcludedPrice(sv.price, taxRate),
    tax_rate: taxRate === 8 ? 8 : 10,
    quantity: 1,
    // variant.title は選択肢ラベル（例 "3本セット(送料無料)"）。単品既定の "Default Title" は空へ。
    variation_value: sv.title === "Default Title" ? "" : sv.title,
    shipping_type: /送料無料/.test(sv.title) ? "送料無料" : "送料別",
  });
}

/** product query の結果を編集対象 subset（Partial<ProductInput>）へパースする。
 * 在庫数は本フローの対象外（inventory 系 API 管轄。docs/shopify/08 §1-4）。 */
export function parseShopifyItem(
  node: ShopifyProductNode,
  opts?: { taxRate?: number },
): Partial<ProductInput> {
  const out: Partial<ProductInput> = {};
  const taxRate = taxRateFromTags(node.tags) ?? (opts?.taxRate === 8 ? 8 : opts?.taxRate === 10 ? 10 : 10);

  if (node.title) out.display_name = node.title;
  // Body(HTML) は「imgList ブロック + 説明文」の合成（buildShopifyBodyHtml）。説明文部分だけを取り込む。
  if (node.descriptionHtml) out.description_pc = stripImgList(node.descriptionHtml);
  out.tax_rate = taxRate;

  const first = node.variants[0];
  if (first) {
    if (first.sku) out.ne_code = first.sku;
    out.selling_price = taxExcludedPrice(first.price, taxRate);
    const jan = normalizeJan(first.barcode);
    if (jan) out.jan_code = jan;
  }

  // 多SKU: 全 variant を variants[] へ（編集画面でまとめて価格改定するため。楽天取込と同じ流儀）。
  if (node.variants.length > 0) {
    out.variants = node.variants.map((sv) => toAppVariant(sv, taxRate));
  }
  return out;
}
