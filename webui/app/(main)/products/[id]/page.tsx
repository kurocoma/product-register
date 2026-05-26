import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dbRowToProductInput, getProduct } from "@/lib/product/repository";
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
  return <ProductEditView initial={product} productId={id} />;
}
