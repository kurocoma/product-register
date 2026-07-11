import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/product/repository";
import { CsvBulkDownloadForm } from "@/components/csv/CsvBulkDownloadForm";

export default async function CsvDownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const supabase = await createClient();
  const products = await listProducts(supabase);
  const items = products.map((p) => ({
    id: p.id,
    ne_code: String(p.ne_code),
    product_name: String(p.product_name),
  }));

  // 商品一覧の「選択を一括 CSV 出力」から渡された ids を初期チェックに引き継ぐ
  // （存在する商品IDだけに絞る。1件も残らなければ従来どおり全チェック）
  const existing = new Set(items.map((p) => p.id));
  const initialSelectedIds = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => id && existing.has(id));

  return (
    <CsvBulkDownloadForm
      products={items}
      initialSelectedIds={initialSelectedIds.length > 0 ? initialSelectedIds : undefined}
    />
  );
}
