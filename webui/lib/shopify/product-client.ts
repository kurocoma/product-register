/** Shopify 商品クライアント（product query / productUpdate / productVariantsBulkUpdate ほか）。
 * 使い分け（docs/shopify/08 §0）:
 *  - 商品情報（title/descriptionHtml 等）= productUpdate（部分更新。価格・variants は変更不可）
 *  - 価格 = productVariantsBulkUpdate（variant gid + 変更フィールドのみ送信）
 *  - productSet は編集フローでは使わない（リスト系が全置換＝未送信 variant が消える）
 * 全 mutation で userErrors を検査してから成功扱いにする（docs/shopify/06 §1）。 */
import { shopifyGraphQL, formatUserErrors, type UserError } from "./graphql-client";
import type { ShopifyConfig } from "./auth";

/** variant 配下の inventoryItem（在庫系 mutation の対象 ID・SKU・追跡・原価）。
 * cost(unitCost) はスコープ次第で取得できないことがある → その場合 null（getProduct が cost 抜きで再取得）。 */
export type ShopifyInventoryItemNode = {
  id: string;
  sku: string;
  tracked: boolean | null;
  cost: string | null; // unitCost.amount（ストア既定通貨。docs/shopify/08 §1-2）
};

export type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  taxable: boolean | null;
  /** 全ロケーション合計の在庫数（参照用。更新は inventory-client 管轄。docs/shopify/08 §1-4） */
  inventoryQuantity: number | null;
  inventoryItem: ShopifyInventoryItemNode | null;
};

export type ShopifyProductNode = {
  id: string;
  title: string;
  descriptionHtml: string;
  status: string;
  vendor: string;
  handle: string;
  productType: string;
  tags: string[];
  seo: { title: string; description: string };
  variants: ShopifyVariantNode[];
};

/** 入力（数値ID / gid）を Product の Global ID へ正規化する（docs/shopify/01 §4）。不正は null。 */
export function toProductGid(code: string): string | null {
  const t = code.trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(t)) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/Product/${t}`;
  return null;
}

/** gid の数値部分（表示用）。 */
export function gidToNumericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

// variants は first:50 に抑える（最大クエリコスト 1,000pt 対策。docs/shopify/08 §6-1）。
// §1-1〜§1-4 の取得可能項目をすべて取得する。unitCost(原価) はスコープ次第で
// フィールド単位の ACCESS_DENIED になり得るため、withCost=false の縮退クエリも組める形にする。
function productQuery(withCost: boolean): string {
  return `
query getProduct($id: ID!) {
  product(id: $id) {
    id
    title
    descriptionHtml
    status
    vendor
    handle
    productType
    tags
    seo { title description }
    variants(first: 50) {
      edges {
        node {
          id
          title
          sku
          price
          compareAtPrice
          barcode
          taxable
          inventoryQuantity
          inventoryItem { id sku tracked${withCost ? " unitCost { amount }" : ""} }
        }
      }
    }
  }
}`;
}

type RawInventoryItem = { id?: unknown; sku?: unknown; tracked?: unknown; unitCost?: { amount?: unknown } | null };
type RawVariantNode = Partial<Omit<ShopifyVariantNode, "inventoryItem">> & { inventoryItem?: RawInventoryItem | null };
type RawVariantEdge = { node?: RawVariantNode };

function parseProductNode(raw: Record<string, unknown>): ShopifyProductNode {
  const edges = ((raw.variants as { edges?: RawVariantEdge[] } | undefined)?.edges ?? []) as RawVariantEdge[];
  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  const strOrNull = (x: unknown): string | null => (typeof x === "string" ? x : null);
  const boolOrNull = (x: unknown): boolean | null => (typeof x === "boolean" ? x : null);
  const seo = (raw.seo ?? {}) as { title?: unknown; description?: unknown };
  return {
    id: str(raw.id),
    title: str(raw.title),
    descriptionHtml: str(raw.descriptionHtml),
    status: str(raw.status),
    vendor: str(raw.vendor),
    handle: str(raw.handle),
    productType: str(raw.productType),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    seo: { title: str(seo.title), description: str(seo.description) },
    variants: edges.map((e) => {
      const ii = e.node?.inventoryItem;
      return {
        id: str(e.node?.id),
        title: str(e.node?.title),
        sku: str(e.node?.sku),
        price: str(e.node?.price),
        compareAtPrice: strOrNull(e.node?.compareAtPrice),
        barcode: strOrNull(e.node?.barcode),
        taxable: boolOrNull(e.node?.taxable),
        inventoryQuantity: typeof e.node?.inventoryQuantity === "number" ? e.node.inventoryQuantity : null,
        inventoryItem: ii
          ? { id: str(ii.id), sku: str(ii.sku), tracked: boolOrNull(ii.tracked), cost: strOrNull(ii.unitCost?.amount) }
          : null,
      };
    }),
  };
}

export type GetProductResult =
  | { exists: true; product: ShopifyProductNode }
  | { exists: false; message: string };

/** product query で現状取得（編集スナップショット兼用）。存在しない gid は exists:false。
 * unitCost(原価) がスコープ不足のフィールド単位 ACCESS_DENIED で取れない場合は、
 * cost 抜きの縮退クエリで再取得して parse を続行する（取得失敗で全体を落とさない）。 */
export async function getProduct(cfg: ShopifyConfig, gid: string): Promise<GetProductResult> {
  let r = await shopifyGraphQL(cfg, productQuery(true), { id: gid });
  if (!r.ok && /ACCESS_DENIED|access denied/i.test(r.message)) {
    r = await shopifyGraphQL(cfg, productQuery(false), { id: gid });
  }
  if (!r.ok) return { exists: false, message: r.message };
  const node = r.data?.product;
  if (!node || typeof node !== "object") return { exists: false, message: "not found" };
  return { exists: true, product: parseProductNode(node as Record<string, unknown>) };
}

export type ShopifySearchHit = {
  gid: string;
  /** 管理画面URL末尾の数値ID（取込入力に使う形）。 */
  numericId: string;
  title: string;
  status: string;
};

/** products(query:"title:*…*") で商品名の部分一致検索（260901修正依頼-1: 商品名からの取込用）。 */
export async function searchProductsByTitle(
  cfg: ShopifyConfig,
  text: string,
  first = 20,
): Promise<{ ok: boolean; message?: string; hits: ShopifySearchHit[] }> {
  const QUERY = `
query searchProducts($first: Int!, $query: String!) {
  products(first: $first, query: $query) {
    edges { node { id title status } }
  }
}`;
  // Shopify 検索構文の引用符・バックスラッシュはクエリ崩れの原因になるため空白へ置換する。
  const sanitized = text.replace(/["\\]/g, " ").trim();
  const r = await shopifyGraphQL(cfg, QUERY, { first, query: `title:*${sanitized}*` });
  if (!r.ok) return { ok: false, message: r.message, hits: [] };
  const edges =
    (r.data?.products as { edges?: { node?: { id?: unknown; title?: unknown; status?: unknown } }[] } | undefined)
      ?.edges ?? [];
  const hits = edges
    .map((e) => e.node)
    .filter((n): n is { id: string; title?: unknown; status?: unknown } => typeof n?.id === "string")
    .map((n) => ({
      gid: n.id,
      numericId: gidToNumericId(n.id),
      title: typeof n.title === "string" ? n.title : "",
      status: typeof n.status === "string" ? n.status : "",
    }));
  return { ok: true, hits };
}

export type MutationResult = { ok: boolean; message: string };

type MutationPayload = { userErrors?: UserError[] } & Record<string, unknown>;

function mutationResult(
  r: { ok: boolean; data: Record<string, unknown> | null; message: string },
  payloadKey: string,
): MutationResult {
  if (!r.ok) return { ok: false, message: r.message };
  const payload = r.data?.[payloadKey] as MutationPayload | undefined;
  const ue = formatUserErrors(payload?.userErrors);
  if (!payload || ue) return { ok: false, message: ue || `${payloadKey}: 空レスポンス` };
  return { ok: true, message: "" };
}

/** productUpdate（商品情報の部分更新。省略フィールドは保持。価格・variants は送れない）。
 * 現行シグネチャは product: ProductUpdateInput（input: は Deprecated。docs/shopify/08 §6-3）。 */
export async function updateProduct(
  cfg: ShopifyConfig,
  product: Record<string, unknown>, // { id, title?, descriptionHtml?, ... }
): Promise<MutationResult> {
  const MUTATION = `
mutation productUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id }
    userErrors { field message }
  }
}`;
  return mutationResult(await shopifyGraphQL(cfg, MUTATION, { product }), "productUpdate");
}

/** productVariantsBulkUpdate（既存 variant の部分更新。variant gid + 変更フィールドのみ送信）。
 * allowPartialUpdates は既定 false のまま = 1件でもエラーなら全件不成立（原子性優先。docs/shopify/08 §2）。
 * variants は最大 250 件/リクエスト（docs/shopify/07 §2）— 呼び出し側で分割する。 */
export async function bulkUpdateVariants(
  cfg: ShopifyConfig,
  productId: string,
  variants: Record<string, unknown>[], // [{ id, price?, compareAtPrice?, barcode? }]
): Promise<MutationResult> {
  const MUTATION = `
mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id sku price }
    userErrors { field message }
  }
}`;
  return mutationResult(await shopifyGraphQL(cfg, MUTATION, { productId, variants }), "productVariantsBulkUpdate");
}

/** productCreate（E2E テスト用: DRAFT 商品を作る）。シグネチャは docs/shopify/02 §2 で確認済み。
 * 実機確認（2026-07 Stage1）: status 未指定の既定は DRAFT でなく ACTIVE だった（資料02 §2 の記載と相違。
 * ただし販売チャネル未公開のため顧客には非表示）。テストでは product.status="DRAFT" を明示指定すること。 */
export async function createDraftProduct(
  cfg: ShopifyConfig,
  product: Record<string, unknown>, // { title, status: "DRAFT", ... }
): Promise<{ ok: boolean; message: string; gid: string }> {
  const MUTATION = `
mutation productCreate($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product { id status variants(first: 1) { edges { node { id sku price } } } }
    userErrors { field message }
  }
}`;
  const r = await shopifyGraphQL(cfg, MUTATION, { product });
  const base = mutationResult(r, "productCreate");
  const created = (r.data?.productCreate as { product?: { id?: string } } | undefined)?.product;
  return { ...base, gid: created?.id ?? "" };
}

/** productDelete（E2E テスト用の後始末）。mutation の存在は docs/shopify/00 で確認済みだが
 * 入力形は資料に無い（標準の input: {id} を使用）。失敗時は message を握り潰さず返す —
 * E2E 側で「手動削除が必要」と可視化する。 */
export async function deleteProduct(cfg: ShopifyConfig, gid: string): Promise<MutationResult> {
  const MUTATION = `
mutation productDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) {
    deletedProductId
    userErrors { field message }
  }
}`;
  return mutationResult(await shopifyGraphQL(cfg, MUTATION, { input: { id: gid } }), "productDelete");
}
