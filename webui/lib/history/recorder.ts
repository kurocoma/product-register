import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoryAction = "create" | "edit" | "csv_export" | "delete";

export async function recordHistory(
  supabase: SupabaseClient,
  action: HistoryAction,
  productId: string | null,
  detail: Record<string, unknown> = {},
  authenticatedUserId?: string,
): Promise<void> {
  const userId = authenticatedUserId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;
  await supabase.from("history").insert({
    user_id: userId,
    action,
    product_id: productId,
    detail,
  });
}
