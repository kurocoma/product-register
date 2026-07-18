import type { ProductRow } from "@/lib/product/repository";

const PRODUCT_PAGE_SIZE = 1_000;

type ProductPageResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

export type RuleAuditQueryClient = {
  from: (table: "products") => {
    select: (columns: "*") => {
      order: (
        column: "updated_at",
        options: { ascending: false },
      ) => {
        range: (from: number, to: number) => PromiseLike<ProductPageResult>;
      };
    };
  };
};

/** Supabase の1リクエスト上限を越える商品も、更新日時順ですべて取得する。 */
export async function fetchAllProductRows(
  supabase: RuleAuditQueryClient,
): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];

  for (let from = 0; ; from += PRODUCT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("updated_at", { ascending: false })
      .range(from, from + PRODUCT_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as ProductRow[];
    rows.push(...page);
    if (page.length < PRODUCT_PAGE_SIZE) break;
  }

  return rows;
}
