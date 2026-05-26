"use client";

import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";
import { ProductEditView } from "@/components/product/ProductEditView";

// 新規作成時の空デフォルト
const empty: ProductInput = ProductInputSchema.parse({
  ne_code: "",
  jan_code: "0000000000000",
  maker_code: "",
  product_type: "単品",
  quantity: 1,
  product_name: "",
  display_name: "",
  tax_rate: 10,
  selling_price: 0,
  shipping_type: "送料別",
  image_count: 1,
  delivery_method: 4,
  lead_time: 1,
  mall_category_id: "",
});

export default function NewProductPage() {
  return <ProductEditView initial={empty} />;
}
