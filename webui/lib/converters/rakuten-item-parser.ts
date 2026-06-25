import { VariantSchema, type ProductInput, type Variant } from "@/lib/product/schema";
import { DEFAULT_RAKUTEN_STORE } from "@/lib/rakuten/store";

/** variants.{id}.attributes[] → アプリ属性配列。多値属性は先頭値を採用（必須属性は単一値）、名前/値が空の項目は除外。 */
function parseVariantAttributes(
  rawAttrs: unknown,
): { item: string; value: string; unit: string; requirement: string }[] {
  if (!Array.isArray(rawAttrs)) return [];
  return rawAttrs
    .map((a) => {
      const at = (a ?? {}) as { name?: unknown; values?: unknown; unit?: unknown };
      const item = typeof at.name === "string" ? at.name : "";
      const values = Array.isArray(at.values) ? at.values.filter((x): x is string => typeof x === "string") : [];
      const unit = typeof at.unit === "string" ? at.unit : "";
      return { item, value: values[0] ?? "", unit, requirement: "" };
    })
    .filter((a) => a.item !== "" && a.value !== "");
}

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
  opts?: { merchantSku?: string },
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

  // 対象 variant から SKU管理番号・価格・JAN を取り出す。
  // 多SKU商品(1商品ページに複数SKU)を merchantDefinedSkuId(=NEコード)指定で取込む場合は、
  // 先頭でなく一致する variant を選ぶ（SKU検索取込で別SKUを誤取込しないため）。
  const variants = json.variants as Record<string, Record<string, unknown>> | undefined;
  if (variants) {
    let targetId = Object.keys(variants)[0];
    if (opts?.merchantSku) {
      const found = Object.keys(variants).find((k) => {
        const ms = variants[k]?.merchantDefinedSkuId;
        return typeof ms === "string" && ms.trim() === opts.merchantSku;
      });
      if (found) targetId = found;
    }
    if (targetId) {
      out._variantId = targetId;
      // variant キー(SKU管理番号)を保持。upsert/patch の variants.{key} に使う実キー。
      out.rakuten_variant_id = targetId;
      const v = variants[targetId];
      // NEコード = システム連携用SKU番号(merchantDefinedSkuId)を優先。無ければ variant キー(SKU管理番号)。
      const merchantSku = typeof v.merchantDefinedSkuId === "string" ? v.merchantDefinedSkuId.trim() : "";
      out.ne_code = merchantSku || targetId;
      if (typeof v.standardPrice === "string") out.selling_price = Number(v.standardPrice);
      const art = v.articleNumber as { value?: string } | undefined;
      if (art && typeof art.value === "string") out.jan_code = art.value;
      const ship = v.shipping as { postageIncluded?: boolean } | undefined;
      if (ship) out.shipping_type = ship.postageIncluded ? "送料無料" : "送料別";

      // 商品属性 variants.{id}.attributes[] → product.attributes。
      // これを取り込まないと、ジャンル必須属性が欠落して再登録(upsert)が IE0418 で失敗する。
      const attrs = parseVariantAttributes(v.attributes);
      if (attrs.length > 0) out.attributes = attrs;
    }
  }
  return out;
}

/** 楽天 items.get の全 variant を Variant[] へパースする（多SKU取込 P2）。
 * 各SKUの SKU管理番号(variantキー)・NEコード(merchantDefinedSkuId)・JAN(articleNumber.value)・
 * 標準価格・送料無料/別・属性を抽出。1商品ページの全SKUを variants[] に格納する用途。
 * 配送詳細(送料区分/配送方法セット等)は P4 で拡張。 */
export function parseRakutenVariants(json: Record<string, unknown>): Variant[] {
  const variants = json.variants as Record<string, Record<string, unknown>> | undefined;
  if (!variants) return [];
  return Object.entries(variants).map(([key, v]) => {
    const merchantSku = typeof v.merchantDefinedSkuId === "string" ? v.merchantDefinedSkuId.trim() : "";
    const art = v.articleNumber as { value?: unknown } | undefined;
    const janRaw = typeof art?.value === "string" ? art.value.trim() : "";
    const price = Number(v.standardPrice);
    const ship = v.shipping as { postageIncluded?: boolean } | undefined;
    return VariantSchema.parse({
      sku_manage_number: key,
      ne_code: merchantSku || key,
      jan_code: /^\d{13}$/.test(janRaw) ? janRaw : "",
      selling_price: Number.isFinite(price) ? Math.round(price) : 0,
      tax_rate: 10,
      quantity: 1,
      shipping_type: ship?.postageIncluded ? "送料無料" : "送料別",
      attributes: parseVariantAttributes(v.attributes),
    });
  });
}
