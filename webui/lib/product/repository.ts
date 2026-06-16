import type { SupabaseClient } from "@supabase/supabase-js";
import { ProductInputSchema, type ProductInput } from "./schema";
import { recordHistory } from "@/lib/history/recorder";

/** DB の products テーブル上で「主要列」として持つフィールド (28列)。残りは extra JSONB へ。 */
const MAIN_COLUMNS = [
  "ne_code", "jan_code", "maker_code", "product_type", "quantity",
  "product_name", "display_name", "tax_rate", "cost_price", "selling_price",
  "shipping_type", "image_count", "delivery_method", "lead_time", "mall_category_id",
  "store_category", "yahoo_category_id", "yahoo_path", "unit",
  "yahoo_grouping_enabled", "yahoo_variation_title",
  "description_pc", "description_sp", "catch_copy_pc", "catch_copy_yahoo",
] as const;

const MAIN_COLUMN_SET = new Set<string>(MAIN_COLUMNS);

/** メタ用キー (DB が自動で持つ). 復元時はスキップ。 */
const META_KEYS = new Set(["id", "user_id", "created_at", "updated_at", "extra"]);

export type ProductRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  extra: Record<string, unknown>;
} & Record<typeof MAIN_COLUMNS[number], unknown>;

/** 保存前バリデーション。ne_code が空だと (user_id, ne_code) ユニーク制約上、
 * 空文字同士が衝突するため保存させない。 */
export function validateForSave(
  product: ProductInput,
): { ok: true } | { ok: false; message: string } {
  if (!product.ne_code || !product.ne_code.trim()) {
    return { ok: false, message: "NEコードは必須です（商品ごとに一意の値を入力してください）" };
  }
  return { ok: true };
}

/** DB エラーを画面表示用の分かりやすい日本語に変換する。
 * 特に 23505 (ユニーク制約違反) を NEコード重複として明示する。 */
export function humanizeSaveError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "23505" && /ne_code/.test(e.message ?? "")) {
    return "このNEコードは既に使われています。別のNEコードを入力してください。";
  }
  return e?.message ?? "保存に失敗しました";
}

/** ProductInput → DB row (主要列 + extra) に分割。 */
export function productInputToDbRow(p: ProductInput): Record<string, unknown> {
  const dbRow: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    if (key === "is_single" || key === "is_set") continue; // 派生プロパティ
    if (MAIN_COLUMN_SET.has(key)) {
      dbRow[key] = value;
    } else {
      extra[key] = value;
    }
  }
  dbRow.extra = extra;
  return dbRow;
}

/** DB row → ProductInput を復元。 */
export function dbRowToProductInput(row: ProductRow): ProductInput {
  const raw: Record<string, unknown> = { ...row.extra };
  for (const [key, value] of Object.entries(row)) {
    if (META_KEYS.has(key)) continue;
    raw[key] = value;
  }
  return ProductInputSchema.parse(raw);
}

/** 商品一覧を取得 (updated_at DESC)。 */
export async function listProducts(supabase: SupabaseClient): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductRow[];
}

/** 1 商品を ID で取得。 */
export async function getProduct(supabase: SupabaseClient, id: string): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProductRow | null) ?? null;
}

/** 商品の作成・更新 (id があれば更新、 なければ作成)。 */
export async function upsertProduct(
  supabase: SupabaseClient,
  product: ProductInput,
  id?: string,
): Promise<ProductRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const valid = validateForSave(product);
  if (!valid.ok) throw new Error(valid.message);

  const dbRow = productInputToDbRow(product);
  dbRow.user_id = user.id;
  dbRow.updated_at = new Date().toISOString();

  if (id) {
    const { data, error } = await supabase
      .from("products")
      .update(dbRow)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(humanizeSaveError(error));
    await recordHistory(supabase, "edit", id, { ne_code: product.ne_code });
    return data as ProductRow;
  }
  const { data, error } = await supabase
    .from("products")
    .insert(dbRow)
    .select()
    .single();
  if (error) throw new Error(humanizeSaveError(error));
  const newRow = data as ProductRow;
  await recordHistory(supabase, "create", newRow.id, { ne_code: product.ne_code });
  return newRow;
}

/** 商品を削除。 */
export async function deleteProduct(supabase: SupabaseClient, id: string): Promise<void> {
  // history.product_id は ON DELETE SET NULL なので、 先に履歴を残してから削除
  const { data: row } = await supabase.from("products").select("ne_code").eq("id", id).maybeSingle();
  await recordHistory(supabase, "delete", id, { ne_code: row?.ne_code ?? "" });
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

/** NEコード / 商品名で検索 (部分一致)。 */
export async function searchProducts(
  supabase: SupabaseClient,
  query: string,
): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .or(`ne_code.ilike.%${query}%,product_name.ilike.%${query}%`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductRow[];
}
