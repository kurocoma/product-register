import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/product/repository";
import { CsvBulkDownloadForm } from "@/components/csv/CsvBulkDownloadForm";

export default async function CsvDownloadPage() {
  const supabase = await createClient();
  const products = await listProducts(supabase);
  const items = products.map((p) => ({
    id: p.id,
    ne_code: String(p.ne_code),
    product_name: String(p.product_name),
  }));
  return <CsvBulkDownloadForm products={items} />;
}
