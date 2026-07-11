import type { SupabaseClient } from "@supabase/supabase-js";

/** 楽天ジャンルの推奨属性1件分 */
export type GenreAttribute = {
  item_name: string;
  requirement: string;
  recommended_unit: string;
  unit_choices: string;
  has_unit: boolean;
  sort_order: number;
};

/** ジャンルID(=モール基本カテゴリID)で推奨属性一覧を並び順で取得する。 */
export async function fetchGenreAttributes(
  supabase: SupabaseClient,
  genreId: string,
): Promise<GenreAttribute[]> {
  const id = genreId.trim();
  if (!id) return [];
  const { data, error } = await supabase
    .from("rakuten_genre_attributes")
    .select("item_name, requirement, recommended_unit, unit_choices, has_unit, sort_order")
    .eq("genre_id", id)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GenreAttribute[];
}

/** 推奨属性一覧を ProductInput.attributes の形（item/value/unit）へ変換する。
 * value は空（ユーザーが入力する）。unit は楽天推奨単位を初期値にする。 */
export function genreAttributesToInputs(
  attrs: GenreAttribute[],
): { item: string; value: string; unit: string; requirement: string }[] {
  return attrs.map((a) => ({
    item: a.item_name,
    value: "",
    unit: a.recommended_unit || "",
    requirement: a.requirement || "",
  }));
}

/** 必須系（必須・いずれか必須）かどうか判定する。 */
export function isRequiredAttribute(requirement: string): boolean {
  return requirement === "必須" || requirement === "いずれか必須";
}

/** 値が空のままの必須系属性（必須・いずれか必須）の件数を数える。
 * 空白のみの value も「空」とみなす。カテゴリIDからの属性自動読み込み直後や
 * 属性セクションの常時通知に使う（楽天は必須属性が空だと登録に失敗するため）。 */
export function countEmptyRequiredAttributes(
  attrs: readonly { value?: string; requirement?: string }[],
): number {
  return attrs.filter(
    (a) => isRequiredAttribute(a.requirement ?? "") && (a.value ?? "").trim() === "",
  ).length;
}
