/** Shopify 部分更新の差分計算とペイロード組立。
 *
 * 設計上の注意（docs/shopify/08 §2・§4）:
 * - 比較はすべて「Shopify 空間」で行う。価格・表示価格はアプリ税抜→税込へ変換
 *   （priceWithTax = CSV と同一式）してから snapshot と比べるため、
 *   税抜⇄税込の丸め往復による幻差分が出ない。
 * - 商品情報（title / descriptionHtml / vendor / tags / status / productType / SEO）は
 *   productUpdate、SKU 別（価格 / compareAtPrice / JAN=barcode）は
 *   productVariantsBulkUpdate へ仕分ける（productUpdate は価格・variants を更新できない）。
 * - Body(HTML) は snapshot の <!--imgList--> 画像ブロックを保持し、説明文部分だけ差し替える
 *   （buildShopifyBodyHtml の合成規約の逆操作。画像タグを消さない）。
 * - tags は全置換のため、snapshot からアプリ管理タグ（メーカー名・税率N%）だけ差し替え、
 *   他のタグを保持する決定的マージで全量送信する（既存タグ消失事故の防止）。
 * - Shopify 固有項目（status / 商品タイプ / SEO）はアプリに対応列が無いため、
 *   product.shopify_overrides（extra JSONB 往復）に設定されている項目だけを差分計画に載せる。
 * - SKU 照合キーは ne_code ↔ Shopify variant.sku（CSV 登録規約: Variant SKU = ne_code）。
 * - SKU の追加/削除は部分更新で表現しない（追加=BulkCreate 別系統、削除=productSet 全置換のみ）。
 *   rakuten-patch の detectVariantStructuralChange と同じく検出して呼び出し側でガードする。
 *
 * 本編集フローの対象外（依頼範囲は商品情報と在庫のみ。理由つき）:
 * - 画像: productUpdate の media は「追加のみ」で差し替え・削除を部分更新で表現できない
 *   （docs/shopify/08 §1-5。画像は ImageUploadPanel + 登録系の管轄）。
 * - 公開チャネル: publishablePublish 系は要 write_publications スコープ（現アプリに無い）で、
 *   status とは別系統の操作（08 §1-6）。
 * - メタフィールド: metafieldsSet のキー単位 upsert 挙動が未確認（08 §8-7）。
 * - オプション構成変更（軸の追加・改名）: productSet 全置換のみ = 未送信 variant の削除事故になる
 *   （08 §1-3・§8-8）。
 * - handle（URL スラッグ）: 重複エラー・リダイレクト副作用があるため参照のみ（08 §1-1。_shopifyMeta で保持）。
 * - compareAtPrice の解除（null クリア）: 可否が §8-9 未確認のため対象外（skipped に注記して保持）。
 * - 在庫数・原価の更新: 実装は lib/shopify/inventory-client.ts にあるが、現アプリのスコープ
 *   （read_products / write_products）では実行できないため UI 非公開（スコープ追加案内のエラーを返す）。 */
import { productVariants, type ProductInput, type Variant } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";
import type { ShopifyProductNode } from "@/lib/shopify/product-client";
import { priceWithTax, addTableClass } from "./shopify";
import { extractImgList, makerNameFromVendor, vendorCodeSuffix } from "./shopify-item-parser";

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

/** 編集後のメーカー名から、送信すべき Vendor を組み立てる。
 * snapshot の `<br>商品コード:...` 接尾辞（CSV 登録規約）は保持してメーカー名だけ差し替える。 */
export function buildExpectedVendor(snapshotVendor: string, makerName: string): string {
  return makerName + vendorCodeSuffix(snapshotVendor);
}

/** 編集後のタグ全量を組み立てる（productUpdate の tags は全置換のため、マージ必須）。
 * アプリが管理するのは「メーカー名」と「税率N%」の 2 タグのみ（shopify.ts の Tags 出力規約）:
 *  1. snapshot から税率タグと旧メーカータグ（snapshot Vendor から復元）を除去
 *  2. 新しいメーカー名タグ・税率タグを先頭に追加（メーカー名が空なら税率タグのみ）
 *  3. それ以外の既存タグはそのまま保持する（消失事故防止）
 * 比較は順序不問（Shopify のタグ順は保証されない）→ sameTagSet で判定する。 */
export function buildExpectedTags(
  snap: Pick<ShopifyProductNode, "vendor" | "tags">,
  product: Pick<ProductInput, "maker_name" | "tax_rate">,
): string[] {
  const newMaker = (product.maker_name ?? "").trim();
  const oldMaker = makerNameFromVendor(snap.vendor ?? "");
  const keep = snap.tags.filter((t) => {
    const s = t.trim();
    if (!s) return false;
    if (/^税率\d+%$/.test(s)) return false; // アプリ管理: 税率タグ（新値で置き換える）
    // アプリ管理: メーカータグ。新メーカー名があるときだけ旧メーカータグを差し替え対象にする
    // （maker_name 未入力の商品では既存メーカータグに触らない）。
    if (newMaker && (s === oldMaker || s === newMaker)) return false;
    return true;
  });
  const managed = newMaker ? [newMaker, `税率${product.tax_rate}%`] : [`税率${product.tax_rate}%`];
  return [...managed, ...keep];
}

/** タグ集合の一致判定（順序不問・前後空白無視）。幻差分防止のため順序違いは差分にしない。 */
export function sameTagSet(a: string[], b: string[]): boolean {
  const norm = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort();
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((x, i) => x === nb[i]);
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
  const skipped: string[] = [];

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

  // メーカー名（Vendor）— `<br>商品コード:` 接尾辞は snapshot のまま保持してメーカー名だけ差し替える。
  // 比較はメーカー名同士（意味比較）で行い、空白等の表記ゆれで幻差分を出さない。maker_name 未入力は対象外。
  const makerName = (product.maker_name ?? "").trim();
  if (makerName && makerName !== makerNameFromVendor(snap.vendor)) {
    const expectedVendor = buildExpectedVendor(snap.vendor, makerName);
    changed.push({ field: "maker_name", before: snap.vendor, after: expectedVendor });
    pu.vendor = expectedVendor;
  }

  // タグ — 全置換のためマージ全量送信（アプリ管理のメーカー名・税率タグだけ差し替え、他は保持）。
  // 順序不問の集合比較（Shopify のタグ順に依存しない = 幻差分防止）。
  const expectedTags = buildExpectedTags(snap, product);
  if (!sameTagSet(expectedTags, snap.tags)) {
    changed.push({ field: "tags", before: snap.tags.join(", "), after: expectedTags.join(", ") });
    pu.tags = expectedTags;
  }

  // Shopify 固有項目（対応列なし）— shopify_overrides に設定されている項目だけ扱う（未設定=現状保持）。
  const ov = product.shopify_overrides ?? {};
  if (ov.status !== undefined && ov.status !== snap.status) {
    changed.push({ field: "status", before: snap.status, after: ov.status });
    pu.status = ov.status;
  }
  if (ov.product_type !== undefined && ov.product_type !== (snap.productType ?? "")) {
    changed.push({ field: "shopify_product_type", before: snap.productType ?? "", after: ov.product_type });
    pu.productType = ov.product_type;
  }
  // SEO — title / description の一方だけ変更でも SEOInput は両方埋めて送る
  // （省略サブフィールドの保持は §8 未確認のため、既知の値で明示上書きして安全側に倒す）。
  const snapSeoTitle = snap.seo?.title ?? "";
  const snapSeoDesc = snap.seo?.description ?? "";
  const seoTitleChanged = ov.seo_title !== undefined && ov.seo_title !== snapSeoTitle;
  const seoDescChanged = ov.seo_description !== undefined && ov.seo_description !== snapSeoDesc;
  if (seoTitleChanged) changed.push({ field: "seo_title", before: snapSeoTitle, after: ov.seo_title });
  if (seoDescChanged) changed.push({ field: "seo_description", before: snapSeoDesc, after: ov.seo_description });
  if (seoTitleChanged || seoDescChanged) {
    pu.seo = {
      title: seoTitleChanged ? ov.seo_title : snapSeoTitle,
      description: seoDescChanged ? ov.seo_description : snapSeoDesc,
    };
  }

  // SKU 別（価格=税込・表示価格=compareAtPrice・JAN=barcode）。
  // 既存 variant（snapshot に sku 一致がある）だけを差分送信。
  const bySku = new Map(snap.variants.map((sv) => [sv.sku.trim(), sv]));
  for (const v of productVariants(product)) {
    const key = shopifyVariantKey(v);
    if (!key) continue; // キー未入力は structural ガード対象
    const sv = bySku.get(key);
    if (!sv) continue; // snapshot に無い = 新規SKUは部分更新不可（structural ガード対象）
    const input: Record<string, unknown> = {};

    // 税率は商品レベル(product.tax_rate)が正（variant側は古い値が残ることがある。260715修正）。
    const expectedPrice = priceWithTax({ selling_price: v.selling_price, tax_rate: product.tax_rate });
    const snapPrice = Number(sv.price);
    if (!Number.isFinite(snapPrice) || snapPrice !== expectedPrice) {
      changed.push({ field: `SKU[${key}].販売価格(税込)`, before: sv.price, after: String(expectedPrice) });
      input.price = String(expectedPrice); // Money は文字列表記を既定とする（docs/shopify/08 §2）
    }

    // 表示価格（二重価格）→ compareAtPrice（税込変換）。variant.display_price 優先、
    // フラット商品（variants 未設定）は product.display_price に従う（variantDisplayPrice と同じ優先順位）。
    // 未設定(0) は「送らない」— クリア（null 送信）の可否は §8-9 未確認のため、解除は対象外とする。
    const rawDisplay = v.display_price && v.display_price > 0
      ? v.display_price
      : product.variants.length === 0 && product.display_price > 0
        ? product.display_price
        : 0;
    if (rawDisplay > 0) {
      const expectedCompareAt = priceWithTax({ selling_price: rawDisplay, tax_rate: product.tax_rate });
      const snapCompareAt = sv.compareAtPrice == null ? NaN : Number(sv.compareAtPrice);
      if (!Number.isFinite(snapCompareAt) || snapCompareAt !== expectedCompareAt) {
        changed.push({ field: `SKU[${key}].表示価格(税込)`, before: sv.compareAtPrice ?? "", after: String(expectedCompareAt) });
        input.compareAtPrice = String(expectedCompareAt);
      }
    } else if (sv.compareAtPrice != null) {
      // Shopify 側に参考価格があるがアプリは未設定 → 消さずに保持し、対象外として注記する。
      skipped.push(`SKU[${key}].表示価格(解除は未対応: Shopify管理画面で削除してください)`);
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
  return { changed, productUpdateInput, variantsInput, skipped };
}
