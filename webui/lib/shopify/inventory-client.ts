/** Shopify 在庫クライアント（inventorySetQuantities / inventoryItemUpdate / locations query）。
 * 使い分け（docs/shopify/08 §0・§1-4）:
 *  - 在庫数 = inventorySetQuantities（絶対値設定・name:"available"・CAS 対応）
 *  - SKU/原価/追跡 ON・OFF = inventoryItemUpdate（部分更新）
 *  - ロケーション一覧 = locations query（inventorySetQuantities の locationId 取得用）
 *
 * 【スコープ】在庫系は read_inventory / write_inventory / read_locations が必要。
 * price-updater-6（2026-07-07 リリース）で追加済み — 実機で動作確認済み。
 * 万一スコープが失われた場合も ACCESS_DENIED を握り潰さず、
 * 「スコープの追加が必要」というユーザーに分かるメッセージへ変換して返す（docs/shopify/08 §3）。 */
import { shopifyGraphQL, formatUserErrors, type UserError } from "./graphql-client";
import type { ShopifyConfig } from "./auth";

/** ACCESS_DENIED / スコープ不足のエラー文言を検出し、対処方法つきの日本語メッセージを返す。
 * 該当しないエラー（バリデーション等）は null（元メッセージのまま表示させる）。 */
export function inventoryScopeHint(message: string): string | null {
  if (!/ACCESS_DENIED|access denied|required access|access scope/i.test(message)) return null;
  return (
    "Shopify の在庫の取得・更新には権限（スコープ）が不足しています。" +
    "Dev Dashboard でアプリの新バージョンを作成して read_inventory / write_inventory" +
    "（ロケーション取得には read_locations）を追加し、リリース後に再実行してください。"
  );
}

export type InventoryMutationResult = {
  ok: boolean;
  message: string;
  /** スコープ不足が原因（メッセージにスコープ追加の案内を含む） */
  needsScope: boolean;
};

type MutationPayload = { userErrors?: UserError[] } & Record<string, unknown>;

/** graphql 結果 → 在庫系の結果へ整形（ACCESS_DENIED はスコープ案内メッセージへ変換）。 */
function inventoryResult(
  r: { ok: boolean; data: Record<string, unknown> | null; message: string },
  payloadKey: string,
): InventoryMutationResult {
  const raw = (() => {
    if (!r.ok) return r.message;
    const payload = r.data?.[payloadKey] as MutationPayload | undefined;
    const ue = formatUserErrors(payload?.userErrors);
    if (!payload || ue) return ue || `${payloadKey}: 空レスポンス`;
    return "";
  })();
  if (!raw) return { ok: true, message: "", needsScope: false };
  const hint = inventoryScopeHint(raw);
  return { ok: false, message: hint ? `${hint}（詳細: ${raw}）` : raw, needsScope: !!hint };
}

export type SetQuantityEntry = { inventoryItemId: string; locationId: string; quantity: number };

/** inventorySetQuantities（在庫数の絶対値設定。name:"available"・reason 必須。docs/shopify/08 §1-4）。
 * CAS(compareQuantity) は使わず ignoreCompareQuantity:true（楽天 inventory の ABSOLUTE と同じ流儀）。
 * 要 write_inventory — 現アプリのスコープには無いため、実行すると needsScope:true で返る。 */
export async function setAvailableQuantities(
  cfg: ShopifyConfig,
  entries: SetQuantityEntry[],
): Promise<InventoryMutationResult> {
  const MUTATION = `
mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { reason }
    userErrors { field message }
  }
}`;
  const input = {
    name: "available",
    reason: "correction",
    ignoreCompareQuantity: true,
    quantities: entries.map((e) => ({
      inventoryItemId: e.inventoryItemId,
      locationId: e.locationId,
      quantity: e.quantity,
    })),
  };
  return inventoryResult(await shopifyGraphQL(cfg, MUTATION, { input }), "inventorySetQuantities");
}

/** inventoryItemUpdate（SKU・原価・追跡 ON/OFF の部分更新。InventoryItemInput。docs/shopify/08 §1-4）。
 * 要 write_inventory — 現アプリのスコープには無いため、実行すると needsScope:true で返る。 */
export async function updateInventoryItem(
  cfg: ShopifyConfig,
  inventoryItemId: string,
  input: { sku?: string; cost?: string; tracked?: boolean },
): Promise<InventoryMutationResult> {
  const MUTATION = `
mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem { id sku tracked }
    userErrors { field message }
  }
}`;
  return inventoryResult(await shopifyGraphQL(cfg, MUTATION, { id: inventoryItemId, input }), "inventoryItemUpdate");
}

/** inventoryActivate（在庫アイテムをロケーションで有効化 + 初期在庫設定）。
 * 未有効化のまま inventorySetQuantities すると "Inventory item is not stocked at location"
 * になるための前段（docs/shopify/06 §2・商品登録〜更新URL一覧 §6）。 */
export async function activateInventory(
  cfg: ShopifyConfig,
  inventoryItemId: string,
  locationId: string,
  available: number,
): Promise<InventoryMutationResult> {
  const MUTATION = `
mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
    inventoryLevel { id }
    userErrors { field message }
  }
}`;
  return inventoryResult(
    await shopifyGraphQL(cfg, MUTATION, { inventoryItemId, locationId, available }),
    "inventoryActivate",
  );
}

export type ShopifyLocation = { id: string; name: string; isActive: boolean };

export type GetLocationsResult =
  | { ok: true; locations: ShopifyLocation[] }
  | { ok: false; message: string; needsScope: boolean };

/** locations query（inventorySetQuantities の locationId 取得用。docs/shopify/08 §1-4）。
 * 要 read_locations — 現アプリのスコープには無いため、実行すると needsScope:true で返る。 */
export async function getLocations(cfg: ShopifyConfig): Promise<GetLocationsResult> {
  const QUERY = `
query getLocations {
  locations(first: 10) {
    edges { node { id name isActive } }
  }
}`;
  const r = await shopifyGraphQL(cfg, QUERY);
  if (!r.ok) {
    const hint = inventoryScopeHint(r.message);
    return { ok: false, message: hint ? `${hint}（詳細: ${r.message}）` : r.message, needsScope: !!hint };
  }
  const edges = ((r.data?.locations as { edges?: { node?: Record<string, unknown> }[] } | undefined)?.edges ?? []);
  const locations = edges.map((e) => ({
    id: typeof e.node?.id === "string" ? e.node.id : "",
    name: typeof e.node?.name === "string" ? e.node.name : "",
    isActive: e.node?.isActive === true,
  }));
  return { ok: true, locations };
}
