import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/product/repository";
import { ProductList } from "@/components/product/ProductList";
import { MallImportByCode } from "@/components/product/MallImportByCode";
import { RelatedImportSearch } from "@/components/product/RelatedImportSearch";
import { MigratePanel } from "@/components/product/MigratePanel";

export default async function ProductsPage() {
  const supabase = await createClient();
  const products = await listProducts(supabase);
  return (
    <>
      <div className="px-6 pt-6 space-y-4">
        <MallImportByCode />
        <RelatedImportSearch />
        <MigratePanel />
      </div>
      <ProductList initial={products} />
    </>
  );
}
