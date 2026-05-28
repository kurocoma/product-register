import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  dbRowToProductInput,
  getProduct,
  listProducts,
} from "@/lib/product/repository";
import { ProductEditView } from "@/components/product/ProductEditView";

export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const row = await getProduct(supabase, id);
  if (!row) notFound();
  const product = dbRowToProductInput(row);

  // peers: 同じ base_code を持つ商品リスト (preview の grouping/親子構造で必要)
  const base = `${product.maker_code}-${product.jan_code.slice(-4)}`;
  const allRows = await listProducts(supabase);
  const peers = allRows
    .map((r) => dbRowToProductInput(r))
    .filter((p) => `${p.maker_code}-${p.jan_code.slice(-4)}` === base);

  return <ProductEditView initial={product} productId={id} peers={peers} />;
}
