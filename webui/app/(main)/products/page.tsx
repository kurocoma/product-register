import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/product/repository";
import { ProductList } from "@/components/product/ProductList";

export default async function ProductsPage() {
  const supabase = await createClient();
  const products = await listProducts(supabase);
  return <ProductList initial={products} />;
}
