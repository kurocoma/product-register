import type { SupabaseClient } from "@supabase/supabase-js";
import { SS_SUFFIX } from "./plan";

/** 復元タブに出す -SS コピー行（アプリDB保存分）。 */
export type SsCopyListItem = {
  productId: string;
  ssManageNumber: string;
  originalManageNumber: string;
  name: string;
  updatedAt: string;
};

/** アプリDBに保存済みの -SS コピー一覧（extra->>rakuten_manage_number が "-SS" 終わり）。
 * Server Component（初期表示）と GET ルート（再読込）の両方から使う。 */
export async function listSsCopies(
  supabase: SupabaseClient,
  userId: string,
): Promise<SsCopyListItem[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, product_name, updated_at, extra")
    .eq("user_id", userId)
    .like("extra->>rakuten_manage_number", `%${SS_SUFFIX}`)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const extra = (row.extra ?? {}) as Record<string, unknown>;
    const ssManageNumber = String(extra.rakuten_manage_number ?? "");
    return {
      productId: String(row.id),
      ssManageNumber,
      originalManageNumber: ssManageNumber.endsWith(SS_SUFFIX)
        ? ssManageNumber.slice(0, -SS_SUFFIX.length)
        : ssManageNumber,
      name: String(row.product_name ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    };
  });
}
