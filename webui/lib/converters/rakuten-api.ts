import type { ProductInput } from "@/lib/product/schema";
import { baseCodeOf } from "./rakuten";
import { buildCabinetFileName } from "./cabinet-path";
import { buildRakutenImgList } from "./image-url";

/** 楽天 variant キー(SKU管理番号 = variants.{key})。取込商品は実キー(rakuten_variant_id)を保持しており、
 * NEコード(merchantDefinedSkuId)と別物の外部作成商品でも正しいキーで upsert/patch する。
 * 未保持(新規登録・アプリ作成)は従来どおり ne_code を使う。 */
export function rakutenVariantId(p: ProductInput): string {
  const stored = p.rakuten_variant_id?.trim();
  return stored || p.ne_code;
}

/** 商品管理番号（items.upsert / items.patch / items.get のパス）。
 * 取込商品は実際の管理番号(rakuten_manage_number)を保存しているので最優先で使う
 * （非規約書式でも編集→反映で同一商品へ往復する）。未保存（新規登録・既存商品）は
 * 従来どおり baseCodeOf を冪等キーに使う。 */
export function buildRakutenManageNumber(p: ProductInput): string {
  const stored = p.rakuten_manage_number?.trim();
  if (stored) return stored;
  return baseCodeOf(p);
}

/** 商品画像 images[].location（"/フォルダ/ファイル名.jpg" 形式。/cabinet/ 以降のパス）。 */
function buildImageLocations(p: ProductInput): { type: "CABINET"; location: string }[] {
  const count = Math.max(1, Math.min(20, p.image_count));
  const out: { type: "CABINET"; location: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const t = buildCabinetFileName(p, { kind: "main", index: i });
    out.push({ type: "CABINET", location: `/${t.folder}/${t.filePath}` });
  }
  return out;
}

export type RakutenUpsertBody = Record<string, unknown>;

export type BuildUpsertOptions = {
  /** true で倉庫(非公開)指定。 */
  hideItem?: boolean;
  /** true でサーチ在庫数を非表示(HIDDEN_STOCK)にする。安全登録用。 */
  hideStock?: boolean;
};

/** ProductInput → items.upsert リクエストボディ（単一SKU通常商品）。
 * 注意: upsert は全置換。多SKUグループは将来対応（現状は1商品=1SKU）。在庫は InventoryAPI 別送（本体に含めない）。 */
export function buildRakutenUpsertBody(p: ProductInput, opts: BuildUpsertOptions = {}): RakutenUpsertBody {
  const variantId = rakutenVariantId(p);
  const imgList = buildRakutenImgList(baseCodeOf(p), p.image_count);

  // articleNumber: 13桁JANがあれば value、無ければ店舗オリジナル(3)
  const articleNumber = /^\d{13}$/.test(p.jan_code)
    ? { value: p.jan_code }
    : { exemptionReason: 3 };

  // 商品属性 → variants.{id}.attributes[]（値が入っているものだけ）。
  // ジャンル必須属性はここで満たす（「必須項目色付け」機能が product.attributes に項目/値/単位を保持）。
  const attributes = (p.attributes || [])
    .filter((a) => a.item && a.value)
    .map((a) => (a.unit ? { name: a.item, values: [a.value], unit: a.unit } : { name: a.item, values: [a.value] }));

  const variant: Record<string, unknown> = {
    // システム連携用SKU番号 = NEコード。取込→編集→反映や再登録で NE連携番号を保持する。
    merchantDefinedSkuId: p.ne_code,
    standardPrice: String(p.selling_price),
    articleNumber,
    shipping: { postageIncluded: p.shipping_type === "送料無料" },
  };
  if (attributes.length > 0) variant.attributes = attributes;

  const body: RakutenUpsertBody = {
    title: p.display_name,
    itemType: "NORMAL",
    genreId: p.mall_category_id,
    productDescription: { pc: p.description_pc, sp: imgList + p.description_sp },
    salesDescription: imgList,
    images: buildImageLocations(p),
    payment: { taxIncluded: true, taxRate: String(p.tax_rate / 100) },
    variants: { [variantId]: variant },
  };
  if (p.catch_copy_pc) body.tagline = p.catch_copy_pc;
  if (opts.hideItem) body.hideItem = true;
  if (opts.hideStock) {
    body.unlimitedInventoryFlag = false;
    body.features = { inventoryDisplay: "HIDDEN_STOCK" };
  }
  return body;
}

/** upsert に最低限必要な項目が揃っているか検証する。 */
export function validateUpsertBody(
  manageNumber: string,
  body: RakutenUpsertBody,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!manageNumber || !/^[a-zA-Z0-9_-]+$/.test(manageNumber)) missing.push("manageNumber(英数-_)");
  if (!body.title) missing.push("title");
  if (!body.itemType) missing.push("itemType");
  if (!body.genreId || !/^\d{6}$/.test(String(body.genreId))) missing.push("genreId(6桁)");
  const variants = body.variants as Record<string, { standardPrice?: string }> | undefined;
  if (!variants || Object.keys(variants).length === 0) missing.push("variants");
  else if (!Object.values(variants)[0]?.standardPrice) missing.push("variants.standardPrice");
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
