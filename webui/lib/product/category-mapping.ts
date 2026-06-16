import type { SupabaseClient } from "@supabase/supabase-js";

/** 楽天ジャンルID に対応する Yahoo カテゴリのマッピング1件分 */
export type YahooCategoryMapping = {
  yahoo_category_id: string;
  yahoo_category_name: string;
  yahoo_path: string;
  confidence: string;
};

/** 楽天ジャンルID(=モール基本カテゴリID)から、紐付けられた Yahoo カテゴリを取得する。
 * 該当行が無い、または Yahoo 紐付けが空（confidence=なし）の場合は null を返す。 */
export async function fetchYahooCategoryMapping(
  supabase: SupabaseClient,
  genreId: string,
): Promise<YahooCategoryMapping | null> {
  const id = genreId.trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from("rakuten_yahoo_category_mapping")
    .select("yahoo_category_id, yahoo_category_name, yahoo_path, confidence")
    .eq("genre_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.yahoo_category_id) return null;
  return data as YahooCategoryMapping;
}
