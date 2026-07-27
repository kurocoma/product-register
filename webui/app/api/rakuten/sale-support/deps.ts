import type { SupabaseClient } from "@supabase/supabase-js";
import type { RakutenCredentials } from "@/lib/rakuten";
import { parseRakutenItem, parseRakutenVariants, buildImportedProduct } from "@/lib/converters";
import { upsertProduct, deleteProduct, type ProductInput } from "@/lib/product";
import { recordHistory } from "@/lib/history";
import {
  makeRakutenRmsDeps,
  type SaleSupportDeps,
  type RakutenItemJson,
} from "@/lib/sale-support";

/** アプリDBから管理番号で商品IDを引く（実管理番号 extra->>rakuten_manage_number 優先 → NEコード）。
 *  migrate route の findExistingProduct と同じ照合順（履歴 product_id 連携用・見つからなくても続行）。 */
async function findProductIdByManage(
  supabase: SupabaseClient,
  userId: string,
  manageNumber: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId)
    .eq("extra->>rakuten_manage_number", manageNumber)
    .limit(1);
  if (data && data.length) return String(data[0].id);
  const { data: byNe } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId)
    .eq("ne_code", manageNumber)
    .limit(1);
  return byNe && byNe.length ? String(byNe[0].id) : null;
}

/** -SS コピーのアプリDB行を保存する。items.get 生JSONを取込パーサ（多SKU対応）で
 *  ProductInput 化し、ne_code / rakuten_manage_number = `<元>-SS` で upsertProduct する。
 *  既存の -SS 行があればその行を更新する（重複行を作らない）。 */
async function saveSsCopyRow(
  supabase: SupabaseClient,
  userId: string,
  ssManageNumber: string,
  raw: RakutenItemJson,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseRakutenItem(raw);
  const variants = parseRakutenVariants(raw);
  const merged: Partial<ProductInput> = { ...parsed, ne_code: "" };
  if (variants.length > 0) merged.variants = variants;
  const built = buildImportedProduct("rakuten", ssManageNumber, merged);
  if (!built.ok) return { ok: false, error: built.error };
  const existingId = await findExistingSsRowId(supabase, userId, ssManageNumber);
  try {
    await upsertProduct(supabase, built.product, existingId ?? undefined);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function findExistingSsRowId(
  supabase: SupabaseClient,
  userId: string,
  ssManageNumber: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId)
    .eq("extra->>rakuten_manage_number", ssManageNumber)
    .limit(1);
  return data && data.length ? String(data[0].id) : null;
}

/** 実RMSクライアント（per-call タイムアウト＋QPSペーシング/429再試行）＋アプリDB永続化を束ねた実 deps。 */
export function makeSaleSupportDeps(
  supabase: SupabaseClient,
  userId: string,
  cred: RakutenCredentials,
): SaleSupportDeps {
  return {
    ...makeRakutenRmsDeps(cred),
    saveSsCopy: (ssMn, raw) => saveSsCopyRow(supabase, userId, ssMn, raw),
    findProductId: (mn) => findProductIdByManage(supabase, userId, mn),
    deleteSsRow: async (ssMn) => {
      const id = await findExistingSsRowId(supabase, userId, ssMn);
      if (!id) return { ok: true }; // 行が無ければ削除不要
      try {
        await deleteProduct(supabase, id);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    recordHistory: (productId, detail) => recordHistory(supabase, "edit", productId, detail),
  };
}
