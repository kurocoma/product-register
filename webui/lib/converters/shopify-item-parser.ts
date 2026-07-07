/** Shopify product query の JSON から、編集対象になる項目を ProductInput 部分へパースする。
 * （API 用。CSV エクスポートの shopify.ts とは別モジュール — docs/shopify/08 §5-1 命名注意）
 *
 * 価格の規約: Shopify は税込・アプリは税抜（CSV コンバータ priceWithTax と同一式の逆算）。
 * tax_rate は本アプリ登録商品のタグ「税率N%」（shopify.ts の Tags 規約）から復元し、
 * 無ければ opts.taxRate → 10 に倒す。
 * アプリ側に対応列が無い項目（status / handle / productType / SEO / taxable / 在庫等）は
 * 破棄せず _shopifyMeta 構造体で保持して返す（取込プレビュー・差分表示から参照する）。 */
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

/** Vendor 規約 `{maker_name}<br>商品コード:{base}` の区切り位置（無ければ -1）。 */
function vendorCodeIndex(vendor: string): number {
  return vendor.search(/<br\s*\/?>商品コード:/);
}

/** Vendor からメーカー名を復元する（shopify.ts の Vendor 出力規約の逆操作）。
 * 規約の `<br>商品コード:` 接尾辞が無い外部作成商品は Vendor 全体をメーカー名とみなす。 */
export function makerNameFromVendor(vendor: string): string {
  const i = vendorCodeIndex(vendor);
  return (i >= 0 ? vendor.slice(0, i) : vendor).trim();
}

/** Vendor の `<br>商品コード:...` 接尾辞（無ければ ""）。編集反映時に保持する用。 */
export function vendorCodeSuffix(vendor: string): string {
  const i = vendorCodeIndex(vendor);
  return i >= 0 ? vendor.slice(i) : "";
}

/** アプリ側に対応列が無い Shopify 項目の構造化保持（F1: 破棄しない）。
 * 編集対象外の参照値としてプレビュー・差分表示から参照する。DB 保存対象ではない
 * （呼び出し側が schema.parse 前に分離する。rakuten の _variantId と同じ流儀）。 */
export type ShopifyMeta = {
  status: string;                 // ACTIVE / DRAFT / ARCHIVED（編集は shopify_overrides.status）
  handle: string;                 // URL スラッグ（編集対象外: 重複・リダイレクトの副作用があるため）
  productType: string;            // 商品タイプ（編集は shopify_overrides.product_type）
  seo: { title: string; description: string }; // 編集は shopify_overrides.seo_title / seo_description
  tags: string[];                 // 全タグ（アプリ管理はメーカー名・税率タグのみ。他は patch がマージ保持）
  variants: {
    sku: string;
    taxable: boolean | null;
    inventoryQuantity: number | null; // 参照値（更新は inventory-client 管轄。docs/shopify/08 §1-4）
    inventoryItemId: string;          // 在庫系 mutation の対象 ID
    tracked: boolean | null;
    cost: string | null;              // 原価（unitCost）。スコープ不足で取得できない場合 null
  }[];
};

function toShopifyMeta(node: ShopifyProductNode): ShopifyMeta {
  return {
    status: node.status,
    handle: node.handle,
    productType: node.productType ?? "",
    seo: { title: node.seo?.title ?? "", description: node.seo?.description ?? "" },
    tags: node.tags,
    variants: node.variants.map((sv) => ({
      sku: sv.sku,
      taxable: sv.taxable ?? null,
      inventoryQuantity: sv.inventoryQuantity ?? null,
      inventoryItemId: sv.inventoryItem?.id ?? "",
      tracked: sv.inventoryItem?.tracked ?? null,
      cost: sv.inventoryItem?.cost ?? null,
    })),
  };
}

/** Shopify variant → アプリ Variant。SKU 照合キーは ne_code ↔ variant.sku
 * （CSV 登録規約: Variant SKU = ne_code。sku_manage_number は楽天キーなので使わない）。 */
function toAppVariant(sv: ShopifyVariantNode, taxRate: number): Variant {
  // compareAtPrice(参考価格) → SKU別 表示価格(二重価格)。税抜へ逆算。未設定(null)は付与しない
  // （display_price 未設定 = 販売価格連動のアプリ規約を保つ）。
  const display = sv.compareAtPrice != null ? taxExcludedPrice(sv.compareAtPrice, taxRate) : undefined;
  return VariantSchema.parse({
    sku_manage_number: "",
    ne_code: sv.sku,
    jan_code: normalizeJan(sv.barcode),
    selling_price: taxExcludedPrice(sv.price, taxRate),
    ...(display && display > 0 ? { display_price: display } : {}),
    tax_rate: taxRate === 8 ? 8 : 10,
    quantity: 1,
    // variant.title は選択肢ラベル（例 "3本セット(送料無料)"）。単品既定の "Default Title" は空へ。
    variation_value: sv.title === "Default Title" ? "" : sv.title,
    shipping_type: /送料無料/.test(sv.title) ? "送料無料" : "送料別",
  });
}

/** product query の結果を編集対象 subset（Partial<ProductInput>）へパースする。
 * 在庫数の更新は本フローの対象外（inventory 系 API 管轄。docs/shopify/08 §1-4）だが、
 * 参照値・アプリに対応列が無い項目は _shopifyMeta に構造化保持する（破棄しない）。
 * _shopifyMeta は DB 保存前に分離すること（rakuten の _variantId と同じ流儀）。 */
export function parseShopifyItem(
  node: ShopifyProductNode,
  opts?: { taxRate?: number },
): Partial<ProductInput> & { _shopifyMeta?: ShopifyMeta } {
  const out: Partial<ProductInput> & { _shopifyMeta?: ShopifyMeta } = {};
  const taxRate = taxRateFromTags(node.tags) ?? (opts?.taxRate === 8 ? 8 : opts?.taxRate === 10 ? 10 : 10);

  if (node.title) out.display_name = node.title;
  // Body(HTML) は「imgList ブロック + 説明文」の合成（buildShopifyBodyHtml）。説明文部分だけを取り込む。
  if (node.descriptionHtml) out.description_pc = stripImgList(node.descriptionHtml);
  out.tax_rate = taxRate;

  // Vendor 規約 `{maker_name}<br>商品コード:{base}` → maker_name（無ければ設定しない = 既存値保持）。
  const maker = makerNameFromVendor(node.vendor ?? "");
  if (maker) out.maker_name = maker;

  const first = node.variants[0];
  if (first) {
    if (first.sku) out.ne_code = first.sku;
    out.selling_price = taxExcludedPrice(first.price, taxRate);
    // compareAtPrice(参考価格) → 表示価格(二重価格・税抜)。未設定は 0（販売価格連動）のまま。
    if (first.compareAtPrice != null) {
      const dp = taxExcludedPrice(first.compareAtPrice, taxRate);
      if (dp > 0) out.display_price = dp;
    }
    const jan = normalizeJan(first.barcode);
    if (jan) out.jan_code = jan;
  }

  // 多SKU: 全 variant を variants[] へ（編集画面でまとめて価格改定するため。楽天取込と同じ流儀）。
  if (node.variants.length > 0) {
    out.variants = node.variants.map((sv) => toAppVariant(sv, taxRate));
  }

  // 対応列が無い項目の構造化保持（status / handle / productType / SEO / taxable / 在庫 / 原価）。
  out._shopifyMeta = toShopifyMeta(node);
  return out;
}
