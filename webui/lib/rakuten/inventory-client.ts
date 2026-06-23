/** 楽天 Inventory API 2.0（在庫数の一括更新）。商品登録(items.upsert)後に別送する。
 * 在庫数は items.upsert では設定できず、この API で ABSOLUTE 更新する。 */
import { esaAuthHeader, type RakutenCredentials } from "./cabinet-client";

const BASE = "https://api.rms.rakuten.co.jp/es/2.0";

export type InventoryEntry = { manageNumber: string; variantId: string; quantity: number };

/** inventories/bulk-upsert（最大400件、mode=ABSOLUTE で在庫数を上書き）。 */
export async function bulkUpsertInventory(
  cred: RakutenCredentials,
  entries: InventoryEntry[],
): Promise<{ ok: boolean; status: number; message: string }> {
  const body = {
    inventories: entries.map((e) => ({
      manageNumber: e.manageNumber,
      variantId: e.variantId,
      mode: "ABSOLUTE",
      quantity: e.quantity,
    })),
  };
  const res = await fetch(`${BASE}/inventories/bulk-upsert`, {
    method: "POST",
    headers: { Authorization: esaAuthHeader(cred.serviceSecret, cred.licenseKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 200 || res.status === 201 || res.status === 204) {
    return { ok: true, status: res.status, message: "OK" };
  }
  let message = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text);
    const errs = j.errors || [];
    if (Array.isArray(errs) && errs.length) message = errs.map((e: { code?: string; message?: string }) => `${e.code || ""}: ${e.message || ""}`).join(" / ");
  } catch { /* keep */ }
  return { ok: false, status: res.status, message };
}
