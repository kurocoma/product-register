import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoryAction = "create" | "edit" | "csv_export" | "delete";

export async function recordHistory(
  supabase: SupabaseClient,
  action: HistoryAction,
  productId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("history").insert({
    user_id: user.id,
    action,
    product_id: productId,
    detail,
  });
}
