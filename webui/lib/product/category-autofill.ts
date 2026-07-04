import type { ProductInput } from "./schema";
import { genreAttributesToInputs, type GenreAttribute } from "./genre-attributes";
import type { YahooCategoryMapping } from "./category-mapping";

/** モール基本カテゴリID（楽天ジャンルID）由来の自動補完を ProductInput に適用する純関数。
 *
 * データ取得は products/new（ProductForm）と同一ソースを再利用する:
 * - 商品属性: fetchGenreAttributes → genreAttributesToInputs（項目・推奨単位。値はユーザー入力）
 * - Yahoo カテゴリ: fetchYahooCategoryMapping（yahoo_category_id / yahoo_path）
 * 呼び出し側（一括登録の保存）が上記 fetch の結果を渡し、本関数がマージ規則を持つ。
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
    const merge = (
      current: { item: string; value: string; unit: string; requirement: string }[],
    ) => {
      const byItem = new Map(current.map((a) => [a.item, a]));
      return recommended.map((a) => {
        const prev = byItem.get(a.item);
        return prev
          ? { item: a.item, value: prev.value, unit: prev.unit || a.unit, requirement: a.requirement }
          : a;
      });
    };
    next.attributes = merge(p.attributes ?? []);
    if (next.variants.length > 0) {
      next.variants = next.variants.map((v) => ({ ...v, attributes: merge(v.attributes ?? []) }));
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
