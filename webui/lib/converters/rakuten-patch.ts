import type { ProductInput, Variant } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";
import { rakutenVariantId, buildVariantShippingForPatch, buildRakutenAttributes } from "./rakuten-api";

/** 楽天 items.patch のボディ。変更されたフィールドだけを含む部分更新用。 */
export type RakutenPatchBody = Record<string, unknown>;

/** 楽天 PATCH で扱える商品ページ共通フィールド（SKU別は別系統、Yahoo専用・画像は対象外）。 */
const RAKUTEN_PATCHABLE = new Set([
  "display_name",
  "mall_category_id",
  "catch_copy_pc",
  "description_pc",
  "description_sp",
  "selling_price",
  "jan_code",
  "shipping_type",
]);

/** variant キー（SKU管理番号、無ければ NEコード）。両方空なら ""。 */
export function variantKey(v: Variant): string {
  return v.sku_manage_number?.trim() || v.ne_code?.trim() || "";
}

/** SKU構成の変更（追加/削除/キー未入力）を検出する。
 * items.patch は既存variantの値更新しかできず、SKUの追加(selectorValues/variantSelectors必須)・削除
 * (未指定は保持され残存)を表現できない。これらがある場合は patch を中止し再登録(upsert=全置換)へ誘導する。 */
export function detectVariantStructuralChange(
  snap: Variant[] | undefined,
  edited: Variant[] | undefined,
): { added: string[]; removed: string[]; emptyKey: boolean } {
  const e = edited ?? [];
  if (e.length === 0) return { added: [], removed: [], emptyKey: false };
  const editedKeys = new Set(e.map(variantKey).filter(Boolean));
  const snapKeys = new Set((snap ?? []).map(variantKey).filter(Boolean));
  return {
    added: [...editedKeys].filter((k) => !snapKeys.has(k)),
    removed: [...snapKeys].filter((k) => !editedKeys.has(k)),
    emptyKey: e.some((v) => !variantKey(v)),
  };
}

/** SKUの配送設定が snapshot(a) と edited(b) で変わったか。 */
function variantShippingChanged(a: Variant | undefined, b: Variant): boolean {
  if (!a) return true;
  return (
    a.shipping_type !== b.shipping_type ||
    a.individual_shipping_fee !== b.individual_shipping_fee ||
    a.postage_segment_1 !== b.postage_segment_1 ||
    a.postage_segment_2 !== b.postage_segment_2 ||
    a.shipping_method_group !== b.shipping_method_group
  );
}

/** 多SKUの差分（snapshot.variants vs edited.variants）を ChangedField[] で返す。
 * 反映プレビュー表示と「変更ありか」判定に使う（patch本体は buildRakutenPatchBody が組む）。
 * field 名は "SKU[{key}].販売価格/配送/JAN" 形式。 */
export function diffVariants(snap: Variant[] | undefined, edited: Variant[] | undefined): ChangedField[] {
  const out: ChangedField[] = [];
  if (!edited || edited.length === 0) return out;
  const snapByKey = new Map((snap ?? []).map((v) => [variantKey(v), v]));
  for (const v of edited) {
    const key = variantKey(v);
    const s = snapByKey.get(key);
    if (!s || s.selling_price !== v.selling_price) out.push({ field: `SKU[${key}].販売価格`, before: s?.selling_price, after: v.selling_price });
    if (variantShippingChanged(s, v)) out.push({ field: `SKU[${key}].配送`, before: s?.shipping_type, after: v.shipping_type });
    if (!s || s.jan_code !== v.jan_code) out.push({ field: `SKU[${key}].JAN`, before: s?.jan_code, after: v.jan_code });
  }
  return out;
}

/** 変更フィールド一覧 + 編集後 ProductInput から items.patch ボディを組み立てる。
 *
 * 設計上の注意:
 * - 多SKU(p.variants[])は各SKUを snapshot.variants と比較し、変わったSKUの変わった項目(価格/JAN/配送)
 *   だけを variants.{key} に入れる。複数variantを同時patchできる。
 * - 単品(variants未設定)は従来どおりフラット(selling_price/jan_code/shipping_type)から1 variantを組む。
 *   variantキーは rakuten_variant_id（無ければ ne_code）。ここを ne_code 固定にすると外部作成商品で
 *   別variant新規作成と誤認され IE0269/IE0229/IE0418 になる。
 * - productDescription/title 等の商品ページ共通項目は変更時に完全な値を送る（兄弟項目を失わない）。
 * - 画像(image_count)・Yahoo専用項目はここでは扱わない（別フロー）。
 */
export function buildRakutenPatchBody(
  changed: ChangedField[],
  p: ProductInput,
  snapshot: Partial<ProductInput> = {},
  opts: { includeAttributes?: boolean } = {},
): { body: RakutenPatchBody; variantId: string; skipped: string[] } {
  const fields = new Set(changed.map((c) => c.field));
  // SKU別変更(field "SKU[...]")は variants 経由で扱うので skipped から除外する。
  const skipped = changed.map((c) => c.field).filter((f) => !RAKUTEN_PATCHABLE.has(f) && !f.startsWith("SKU["));

  const body: RakutenPatchBody = {};

  // 商品ページ共通（title/genre/tagline/productDescription）
  if (fields.has("display_name") && p.display_name) body.title = p.display_name;
  if (fields.has("mall_category_id") && p.mall_category_id) body.genreId = p.mall_category_id;
  if (fields.has("catch_copy_pc")) body.tagline = p.catch_copy_pc;
  if (fields.has("description_pc") || fields.has("description_sp")) {
    body.productDescription = {
      pc: fields.has("description_pc") ? p.description_pc : (snapshot.description_pc ?? p.description_pc),
      sp: fields.has("description_sp") ? p.description_sp : (snapshot.description_sp ?? p.description_sp),
    };
  }

  // SKU（variants）
  const variants: Record<string, unknown> = {};
  const pv = p.variants ?? [];
  if (pv.length > 0) {
    // 多SKU: 既存SKU(snapshotに有る)だけを差分patch。空キー・新規SKU(snapshotに無い)は送らない
    // （patchはSKU追加を表現できずIE0156/0269になるため。構造変更は route 側ガードで再登録へ誘導）。
    const snapByKey = new Map((snapshot.variants ?? []).map((v) => [variantKey(v), v]));
    for (const v of pv) {
      const key = variantKey(v);
      if (!key) continue; // キー未入力は送らない
      const s = snapByKey.get(key);
      if (!s) continue; // snapshotに無い=新規SKUはpatch不可（再登録upsertへ）
      const vp: Record<string, unknown> = {};
      if (s.selling_price !== v.selling_price) vp.standardPrice = String(v.selling_price);
      if (s.jan_code !== v.jan_code) {
        vp.articleNumber = /^\d{13}$/.test(v.jan_code) ? { value: v.jan_code } : { exemptionReason: 3 };
      }
      // patchはshipping objectをマージするため、モード切替時に旧キーが残らないようnull明示版を使う。
      if (variantShippingChanged(s, v)) vp.shipping = buildVariantShippingForPatch(v);
      if (Object.keys(vp).length > 0) {
        // IE0418(ジャンル必須属性不足)時の再試行でのみ属性を同梱（通常は最小patch）。
        if (opts.includeAttributes) {
          const attrs = buildRakutenAttributes(v.attributes);
          if (attrs.length > 0) vp.attributes = attrs;
        }
        variants[key] = vp;
      }
    }
  } else {
    // 単品: 従来のフラットロジック（後方互換）
    const variantId = rakutenVariantId(p);
    const variant: Record<string, unknown> = {};
    if (fields.has("selling_price")) variant.standardPrice = String(p.selling_price);
    if (fields.has("jan_code")) {
      variant.articleNumber = /^\d{13}$/.test(p.jan_code) ? { value: p.jan_code } : { exemptionReason: 3 };
    }
    if (fields.has("shipping_type")) {
      variant.shipping = { postageIncluded: p.shipping_type === "送料無料" };
    }
    if (Object.keys(variant).length > 0) {
      if (opts.includeAttributes) {
        const attrs = buildRakutenAttributes(p.attributes);
        if (attrs.length > 0) variant.attributes = attrs;
      }
      variants[variantId] = variant;
    }
  }
  if (Object.keys(variants).length > 0) body.variants = variants;

  const firstKey = pv.length > 0 ? variantKey(pv[0]) : rakutenVariantId(p);
  return { body, variantId: firstKey, skipped };
}
