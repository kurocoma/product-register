import { createClient } from "@/lib/supabase/server";
import { HistoryView, type HistoryRow } from "@/components/history/HistoryView";

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("history")
    .select("id, action, product_id, detail, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, 99);

  return <HistoryView initial={(data ?? []) as HistoryRow[]} />;
}
