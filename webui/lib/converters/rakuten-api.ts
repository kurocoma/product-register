import { productVariants, type ProductInput, type Variant } from "@/lib/product/schema";
import { baseCodeOf } from "./rakuten";
import { buildCabinetFileName } from "./cabinet-path";
import { buildRakutenImgList } from "./image-url";

/** Variant → 楽天 variant.shipping。送料無料は postageIncluded のみ。送料別は
 * 個別送料(fee) XOR 送料区分(postageSegment.local/overseas) を設定（排他、docs/楽天/04の制約）。
 * 配送方法セット(shippingMethodGroup)は併用可。置き配(okihai)は ItemAPI に項目が無く反映対象外。 */
export function buildVariantShipping(v: Variant): Record<string, unknown> {
  const shipping: Record<string, unknown> = {};
  if (v.shipping_type === "送料無料") {
    shipping.postageIncluded = true; // 送料無料時は fee/postageSegment 不可（排他）
  } else {
    shipping.postageIncluded = false;
    const fee = v.individual_shipping_fee?.trim();
    if (fee) {
      shipping.fee = fee; // 個別送料（送料区分とは排他）
    } else {
      const seg: Record<string, number> = {};
      const s1 = Number(v.postage_segment_1);
      const s2 = Number(v.postage_segment_2);
      if (v.postage_segment_1?.trim() && Number.isFinite(s1)) seg.local = s1;
      if (v.postage_segment_2?.trim() && Number.isFinite(s2)) seg.overseas = s2;
      if (Object.keys(seg).length > 0) shipping.postageSegment = seg;
    }
  }
  // 配送方法セットは送料無料/別どちらでも併用可（postageIncluded時も禁止されない）。
  const grp = v.shipping_method_group?.trim();
  if (grp) shipping.shippingMethodGroup = grp;
  return shipping;
}

/** patch用 variant.shipping。楽天 items.patch は shipping(object)をマージ(省略キーは保持)するため
 * (実機検証: 個別送料fee付きSKUに postageIncluded:true だけ送ると IE0153)、モード切替で旧値が残らないよう
 * 設定しないキーを明示的に null で送ってクリアする(実機で null クリア成功を確認)。 */
export function buildVariantShippingForPatch(v: Variant): Record<string, unknown> {
  const grp = v.shipping_method_group?.trim();
  const shipping: Record<string, unknown> = { shippingMethodGroup: grp || null };
  if (v.shipping_type === "送料無料") {
    shipping.postageIncluded = true;
    shipping.fee = null;
    shipping.postageSegment = null;
    return shipping;
  }
  shipping.postageIncluded = false;
  const fee = v.individual_shipping_fee?.trim();
  if (fee) {
    shipping.fee = fee;
    shipping.postageSegment = null; // 個別送料とは排他→区分クリア
    return shipping;
  }
  const seg: Record<string, number> = {};
  const s1 = Number(v.postage_segment_1);
  const s2 = Number(v.postage_segment_2);
  if (v.postage_segment_1?.trim() && Number.isFinite(s1)) seg.local = s1;
  if (v.postage_segment_2?.trim() && Number.isFinite(s2)) seg.overseas = s2;
  shipping.fee = null; // 区分または無指定→個別送料クリア
  shipping.postageSegment = Object.keys(seg).length > 0 ? seg : null;
  return shipping;
}

/** 多SKUの選択肢ラベル一覧（variantSelectors.values / selectorValues 用）。
 * variation_value 優先、無ければ数量(N本)、それも無ければ連番。空・重複は連番を付与して一意化(32字以内)。 */
function uniqueVariationLabels(vlist: Variant[]): string[] {
  const used = new Set<string>();
  return vlist.map((v, i) => {
    const base = (v.variation_value?.trim() || (v.quantity > 0 ? `${v.quantity}本` : "") || `タイプ${i + 1}`).slice(0, 32);
    let label = base;
    let n = 2;
    while (used.has(label)) label = `${base.slice(0, 28)}(${n++})`;
    used.add(label);
    return label;
  });
}

/** アプリ属性配列 → 楽天 variants.{}.attributes[]（item/value が入っているものだけ、unit任意）。
 * ジャンル必須属性(総入数等)を満たすため、upsert だけでなく patch でも variant に同梱する。 */
export function buildRakutenAttributes(
  attrs: { item?: string; value?: string; unit?: string }[] | undefined,
): { name: string; values: string[]; unit?: string }[] {
  return (attrs || [])
    .filter((a): a is { item: string; value: string; unit?: string } => !!a.item && !!a.value)
    .map((a) => (a.unit ? { name: a.item, values: [a.value], unit: a.unit } : { name: a.item, values: [a.value] }));
}

function buildVariantAttributes(v: Variant): { name: string; values: string[]; unit?: string }[] {
  return buildRakutenAttributes(v.attributes);
}

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

/** ProductInput → items.upsert リクエストボディ。
 * 多SKU(variants[])は全SKUを variants{} に展開。単品(variants未設定)は productVariants() が
 * フラットから1件合成するため従来と同一bodyになる（後方互換）。upsertは全置換。
 * 在庫は InventoryAPI 別送（本体に含めない）。 */
export function buildRakutenUpsertBody(p: ProductInput, opts: BuildUpsertOptions = {}): RakutenUpsertBody {
  const imgList = buildRakutenImgList(baseCodeOf(p), p.image_count);

  const vlist = productVariants(p);
  const multi = vlist.length > 1;
  // 多SKUは variantSelectors(バリエーション軸) + 各variantの selectorValues が必須(IE0269)。
  // 単軸とし、選択肢ラベルは variation_value（無ければ数量/連番）。重複・空は連番付与で一意化。
  const axisKey = "type";
  const axisName = (p.yahoo_variation_title?.trim() || "タイプ").slice(0, 32); // displayName は string(32)
  const labels = multi ? uniqueVariationLabels(vlist) : [];

  // SKUごとに variants.{key} を組み立てる（key = SKU管理番号、無ければ NEコード）。
  const variants: Record<string, unknown> = {};
  vlist.forEach((v, i) => {
    const key = v.sku_manage_number?.trim() || v.ne_code;
    // articleNumber: 13桁JANがあれば value、無ければ店舗オリジナル(3)
    const articleNumber = /^\d{13}$/.test(v.jan_code) ? { value: v.jan_code } : { exemptionReason: 3 };
    const variant: Record<string, unknown> = {
      // システム連携用SKU番号 = NEコード。取込→編集→反映や再登録で NE連携番号を保持する。
      merchantDefinedSkuId: v.ne_code,
      standardPrice: String(v.selling_price),
      articleNumber,
      shipping: buildVariantShipping(v),
    };
    const attributes = buildVariantAttributes(v);
    if (attributes.length > 0) variant.attributes = attributes;
    if (multi) variant.selectorValues = { [axisKey]: labels[i] };
    variants[key] = variant;
  });

  const body: RakutenUpsertBody = {
    title: p.display_name,
    itemType: "NORMAL",
    genreId: p.mall_category_id,
    productDescription: { pc: p.description_pc, sp: imgList + p.description_sp },
    salesDescription: imgList,
    images: buildImageLocations(p),
    payment: { taxIncluded: true, taxRate: String(p.tax_rate / 100) },
    variants,
  };
  if (multi) {
    body.variantSelectors = [{ key: axisKey, displayName: axisName, values: labels.map((l) => ({ displayValue: l })) }];
  }
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
