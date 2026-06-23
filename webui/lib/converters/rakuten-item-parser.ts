import type { ProductInput } from "@/lib/product/schema";

/** 楽天 items.get の JSON から、編集対象になる項目を ProductInput 部分へパースする。
 * 在庫数は items.get に含まれない（InventoryAPI 管轄）ため対象外。
 * 構造は実機 items.get で確認済み（docs/楽天/items.get.txt）。 */
export function parseRakutenItem(
  json: Record<string, unknown>,
): Partial<ProductInput> & { _variantId?: string } {
  const out: Partial<ProductInput> & { _variantId?: string } = {};

  if (typeof json.title === "string") out.display_name = json.title;
  if (typeof json.genreId === "string") out.mall_category_id = json.genreId;

  const desc = json.productDescription as { pc?: string; sp?: string } | undefined;
  if (desc) {
    if (typeof desc.pc === "string") out.description_pc = desc.pc;
    if (typeof desc.sp === "string") out.description_sp = desc.sp;
  }
  if (typeof json.tagline === "string") out.catch_copy_pc = json.tagline;

  // 先頭 variant（単一SKU前提）から価格・JAN・SKU管理番号を取り出す
  const variants = json.variants as Record<string, Record<string, unknown>> | undefined;
  if (variants) {
    const firstId = Object.keys(variants)[0];
    if (firstId) {
      out._variantId = firstId;
      out.ne_code = firstId;
      const v = variants[firstId];
      if (typeof v.standardPrice === "string") out.selling_price = Number(v.standardPrice);
      const art = v.articleNumber as { value?: string } | undefined;
      if (art && typeof art.value === "string") out.jan_code = art.value;
      const ship = v.shipping as { postageIncluded?: boolean } | undefined;
      if (ship) out.shipping_type = ship.postageIncluded ? "送料無料" : "送料別";
    }
  }
  return out;
}
