import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/product/repository";
import { ProductList } from "@/components/product/ProductList";
import { MallImportByCode } from "@/components/product/MallImportByCode";

export default async function ProductsPage() {
  const supabase = await createClient();
  const products = await listProducts(supabase);
  return (
    <>
      <div className="px-6 pt-6">
        <MallImportByCode />
      </div>
      <ProductList initial={products} />
    </>
  );
}
