import { createClient } from "@/lib/supabase/server";
import { listProducts } from "@/lib/product/repository";
import { ProductList } from "@/components/product/ProductList";
import { MallImportByCode } from "@/components/product/MallImportByCode";

export default async function ProductsPage() {
  const supabase = await createClient();
  const products = await listProducts(supabase);
  return (
    <>
      {/* 楽天→Yahoo一括移行 / 関連商品（セット）取込 はサイドナビ配下の専用ページへ移行（/migrate, /related-import） */}
      <div className="px-6 pt-6 space-y-4">
        <MallImportByCode />
      </div>
      <ProductList initial={products} />
    </>
  );
}
