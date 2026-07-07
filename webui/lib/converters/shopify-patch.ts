/** Shopify 部分更新の差分計算とペイロード組立。
 *
 * 設計上の注意（docs/shopify/08 §2・§4）:
 * - 比較はすべて「Shopify 空間」で行う。価格はアプリ税抜→税込へ変換（priceWithTax = CSV と同一式）
 *   してから snapshot と比べるため、税抜⇄税込の丸め往復による幻差分が出ない。
 * - 商品情報（title / descriptionHtml）は productUpdate、SKU 別（価格 / JAN=barcode）は
 *   productVariantsBulkUpdate へ仕分ける（productUpdate は価格・variants を更新できない）。
 * - Body(HTML) は snapshot の <!--imgList--> 画像ブロックを保持し、説明文部分だけ差し替える
 *   （buildShopifyBodyHtml の合成規約の逆操作。画像タグを消さない）。
 * - SKU 照合キーは ne_code ↔ Shopify variant.sku（CSV 登録規約: Variant SKU = ne_code）。
 * - SKU の追加/削除は部分更新で表現しない（追加=BulkCreate 別系統、削除=productSet 全置換のみ）。
 *   rakuten-patch の detectVariantStructuralChange と同じく検出して呼び出し側でガードする。 */
import { productVariants, type ProductInput, type Variant } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";
import type { ShopifyProductNode } from "@/lib/shopify/product-client";
import { priceWithTax, addTableClass } from "./shopify";
import { extractImgList } from "./shopify-item-parser";

/** Shopify 照合用の variant キー（= NEコード。楽天の variantKey とはキー系が異なる）。 */
function shopifyVariantKey(v: Variant): string {
  return v.ne_code?.trim() || "";
}

/** SKU 構成の変更（追加/削除/キー未入力）を検出する。ある場合は部分更新を中止する。 */
export function detectShopifyStructuralChange(
  appVariants: Variant[],
  snap: ShopifyProductNode,
): { added: string[]; removed: string[]; emptyKey: boolean } {
  const appKeys = new Set(appVariants.map(shopifyVariantKey).filter(Boolean));
  const shopKeys = new Set(snap.variants.map((sv) => sv.sku.trim()).filter(Boolean));
  return {
    added: [...appKeys].filter((k) => !shopKeys.has(k)),
    removed: [...shopKeys].filter((k) => !appKeys.has(k)),
    emptyKey: appVariants.some((v) => !shopifyVariantKey(v)),
  };
}

/** 編集後の説明文から、送信すべき Body(HTML) を組み立てる。
 * snapshot に imgList ブロックがあれば保持して本文だけ差し替える（無ければ本文のみ）。 */
export function buildExpectedBodyHtml(snapshotBody: string, descriptionPc: string): string {
  const imgList = extractImgList(snapshotBody);
  const body = addTableClass(descriptionPc);
  return imgList ? `${imgList}\n${body}` : body;
}

export type ShopifyPatchPlan = {
  /** 反映プレビュー表示・「変更ありか」判定に使う差分一覧 */
  changed: ChangedField[];
  /** productUpdate へ送る入力（変更が無ければ null）。id を含む */
  productUpdateInput: Record<string, unknown> | null;
  /** productVariantsBulkUpdate へ送る入力（変更 variant のみ。最大250件/回は呼び出し側で分割） */
  variantsInput: Record<string, unknown>[];
  /** 対象外のため送らなかった編集項目の注記 */
  skipped: string[];
};

/** アプリ商品 vs Shopify snapshot の差分から送信プランを組み立てる。
 * 価格・JAN 以外の SKU 項目、キャッチコピー・カテゴリ等の Shopify 非対応項目は対象外
 * （snapshot 側に無い項目は diff されないだけで、値が消えることはない = patch 型）。 */
export function buildShopifyPatchPlan(product: ProductInput, snap: ShopifyProductNode): ShopifyPatchPlan {
  const changed: ChangedField[] = [];
  const pu: Record<string, unknown> = {};
  const variantsInput: Record<string, unknown>[] = [];

  // 商品名（title）
  if (product.display_name && product.display_name !== snap.title) {
    changed.push({ field: "display_name", before: snap.title, after: product.display_name });
    pu.title = product.display_name;
  }

  // 説明文（Body HTML）— imgList ブロックは snapshot のまま保持する
  const expectedBody = buildExpectedBodyHtml(snap.descriptionHtml, product.description_pc);
  if (expectedBody !== snap.descriptionHtml) {
    changed.push({ field: "description_pc", before: snap.descriptionHtml, after: expectedBody });
    pu.descriptionHtml = expectedBody;
  }

  // SKU 別（価格=税込・JAN=barcode）。既存 variant（snapshot に sku 一致がある）だけを差分送信。
  const bySku = new Map(snap.variants.map((sv) => [sv.sku.trim(), sv]));
  for (const v of productVariants(product)) {
    const key = shopifyVariantKey(v);
    if (!key) continue; // キー未入力は structural ガード対象
    const sv = bySku.get(key);
    if (!sv) continue; // snapshot に無い = 新規SKUは部分更新不可（structural ガード対象）
    const input: Record<string, unknown> = {};

    const expectedPrice = priceWithTax(v);
    const snapPrice = Number(sv.price);
    if (!Number.isFinite(snapPrice) || snapPrice !== expectedPrice) {
      changed.push({ field: `SKU[${key}].販売価格(税込)`, before: sv.price, after: String(expectedPrice) });
      input.price = String(expectedPrice); // Money は文字列表記を既定とする（docs/shopify/08 §2）
    }

    const jan = /^\d{13}$/.test(v.jan_code) ? v.jan_code : "";
    if (jan && jan !== (sv.barcode ?? "")) {
      changed.push({ field: `SKU[${key}].JAN(barcode)`, before: sv.barcode ?? "", after: jan });
      input.barcode = jan;
    }

    if (Object.keys(input).length > 0) {
      variantsInput.push({ id: sv.id, ...input });
    }
  }

  const productUpdateInput = Object.keys(pu).length > 0 ? { id: snap.id, ...pu } : null;
  return { changed, productUpdateInput, variantsInput, skipped: [] };
}
