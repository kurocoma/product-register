import type { ProductInput } from "./schema";
import { genreAttributesToInputs, type GenreAttribute } from "./genre-attributes";
import type { YahooCategoryMapping } from "./category-mapping";

/** 商品属性1件分（item/value/unit/requirement）。genreAttributesToInputs の出力と同形。 */
export type GenreAttributeInput = { item: string; value: string; unit: string; requirement: string };

/** 属性マージ規則（手入力優先）の単一実装。
 * ProductForm「カテゴリIDから属性を読み込む」と一括登録の自動補完（applyCategoryAutofill）が
 * 同じ規則を共有する（二重実装で将来 diverge させないための唯一のマージ関数）。
 *
 * 規則: 推奨属性（recommended）の並びに揃えつつ、既存入力（current）の value / unit を
 * item 単位で保持する（unit は既存が空なら推奨単位を採用）。requirement は常に推奨側を採用。
 * current はフォーム入力途中の値も受けるため各フィールド optional を許容する。 */
export function mergeGenreAttributes(
  current: readonly { item?: string; value?: string; unit?: string; requirement?: string }[],
  recommended: readonly GenreAttributeInput[],
): GenreAttributeInput[] {
  const byItem = new Map(current.map((a) => [a.item ?? "", a]));
  return recommended.map((a) => {
    const prev = byItem.get(a.item);
    return prev
      ? { item: a.item, value: prev.value ?? "", unit: prev.unit || a.unit, requirement: a.requirement }
      : a;
  });
}

/** モール基本カテゴリID（楽天ジャンルID）由来の自動補完を ProductInput に適用する純関数。
 *
 * データ取得は products/new（ProductForm）と同一ソースを再利用する:
 * - 商品属性: fetchGenreAttributes → genreAttributesToInputs（項目・推奨単位。値はユーザー入力）
 * - Yahoo カテゴリ: fetchYahooCategoryMapping（yahoo_category_id / yahoo_path）
 * 呼び出し側（一括登録の保存）が上記 fetch の結果を渡し、本関数がマージ規則
 * （mergeGenreAttributes = ProductForm と共有の単一実装）を適用する。
 *
 * マージ規則（手入力優先）:
 * - 属性: 既存入力を item 単位で保持しつつ推奨属性の並びに揃える（ProductForm の
 *   「カテゴリから属性を読み込む」と同じ規則）。推奨属性が空なら既存のまま。
 * - 多SKU（variants[]）商品は各 variant の属性にも同じ規則で補完する
 *   （楽天はジャンル必須属性を variant 単位で送るため）。
 * - Yahoo: yahoo_category_id / yahoo_path それぞれ「空欄のときだけ」補完する。
 */
export function applyCategoryAutofill(
  p: ProductInput,
  attrs: GenreAttribute[],
  yahoo: YahooCategoryMapping | null,
): { product: ProductInput; filled: { attributes: boolean; yahoo: boolean } } {
  const next: ProductInput = { ...p };
  const filled = { attributes: false, yahoo: false };

  if (attrs.length > 0) {
    const recommended = genreAttributesToInputs(attrs);
    // マージ規則は mergeGenreAttributes（ProductForm と共有の単一実装）に委譲する
    next.attributes = mergeGenreAttributes(p.attributes ?? [], recommended);
    if (next.variants.length > 0) {
      next.variants = next.variants.map((v) => ({
        ...v,
        attributes: mergeGenreAttributes(v.attributes ?? [], recommended),
      }));
    }
    filled.attributes = true;
  }

  if (yahoo) {
    if (!p.yahoo_category_id.trim()) {
      next.yahoo_category_id = yahoo.yahoo_category_id;
      filled.yahoo = true;
    }
    if (!p.yahoo_path.trim()) {
      next.yahoo_path = yahoo.yahoo_path;
      filled.yahoo = true;
    }
  }

  return { product: next, filled };
}
