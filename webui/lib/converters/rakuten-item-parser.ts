import type { ProductInput } from "@/lib/product/schema";
import { DEFAULT_RAKUTEN_STORE } from "@/lib/rakuten/store";

/** items.get の images[].location("/画像パス")を公開URLへ変換する。
 * 既に http(s) 完全URLならそのまま。GOLD は gold ドメイン、CABINET は image ドメイン。 */
function toRakutenImageUrl(img: { type?: unknown; location?: unknown }): string {
  const loc = typeof img.location === "string" ? img.location.trim() : "";
  if (!loc) return "";
  if (/^https?:\/\//i.test(loc)) return loc;
  if (img.type === "GOLD") return `https://www.rakuten.ne.jp/gold/${DEFAULT_RAKUTEN_STORE}${loc}`;
  return `https://image.rakuten.co.jp/${DEFAULT_RAKUTEN_STORE}/cabinet${loc}`;
}

/** 楽天 items.get の JSON から、編集対象になる項目を ProductInput 部分へパースする。
 * 在庫数は items.get に含まれない（InventoryAPI 管轄）ため対象外。
 * 構造は実機 items.get で確認済み（docs/楽天/items.get.txt / 03-商品取得検索）。 */
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

  // 商品画像 images[].location → 実画像URLとして image_url_1..20 + image_count に取り込む。
  // 実画像は thum01 や JAN名フォルダ等アプリの自動生成規約(thum02/{ne_code})と一致しないため、
  // 算出ではなく取得した実URLをそのまま保持する。
  const images = json.images;
  if (Array.isArray(images) && images.length > 0) {
    const urls = images
      .map((img) => toRakutenImageUrl((img ?? {}) as { type?: unknown; location?: unknown }))
      .filter((u) => u !== "");
    if (urls.length > 0) {
      out.image_count = urls.length;
      urls.slice(0, 20).forEach((u, i) => {
        (out as Record<string, unknown>)[`image_url_${i + 1}`] = u;
      });
    }
  }

  // 先頭 variant（単一SKU前提）から SKU管理番号・価格・JAN を取り出す。
  const variants = json.variants as Record<string, Record<string, unknown>> | undefined;
  if (variants) {
    const firstId = Object.keys(variants)[0];
    if (firstId) {
      out._variantId = firstId;
      const v = variants[firstId];
      // NEコード = システム連携用SKU番号(merchantDefinedSkuId)を優先。無ければ variant キー(SKU管理番号)。
      const merchantSku = typeof v.merchantDefinedSkuId === "string" ? v.merchantDefinedSkuId.trim() : "";
      out.ne_code = merchantSku || firstId;
      if (typeof v.standardPrice === "string") out.selling_price = Number(v.standardPrice);
      const art = v.articleNumber as { value?: string } | undefined;
      if (art && typeof art.value === "string") out.jan_code = art.value;
      const ship = v.shipping as { postageIncluded?: boolean } | undefined;
      if (ship) out.shipping_type = ship.postageIncluded ? "送料無料" : "送料別";
    }
  }
  return out;
}
