import { describe, it, expect } from "vitest";
import { makeProduct } from "./schema";
import { applyCategoryAutofill, mergeGenreAttributes } from "./category-autofill";
import { genreAttributesToInputs, type GenreAttribute } from "./genre-attributes";

/** 楽天ジャンル推奨属性のマスタ行（fetchGenreAttributes の戻り形）。 */
const genreAttr = (item_name: string, recommended_unit = "", requirement = "任意"): GenreAttribute => ({
  item_name,
  requirement,
  recommended_unit,
  unit_choices: "",
  has_unit: recommended_unit !== "",
  sort_order: 0,
});

const recommended = genreAttributesToInputs([
  genreAttr("内容量", "ml", "必須"),
  genreAttr("原産国/製造国", "", "任意"),
  genreAttr("賞味期限", "日", "任意"),
]);

describe("mergeGenreAttributes（属性マージ規則の単一実装）", () => {
  it("推奨属性の並びに揃え、value は空（ユーザー入力待ち）・unit は推奨単位になる", () => {
    const merged = mergeGenreAttributes([], recommended);
    expect(merged.map((a) => a.item)).toEqual(["内容量", "原産国/製造国", "賞味期限"]);
    expect(merged.map((a) => a.value)).toEqual(["", "", ""]);
    expect(merged.map((a) => a.unit)).toEqual(["ml", "", "日"]);
    expect(merged.map((a) => a.requirement)).toEqual(["必須", "任意", "任意"]);
  });

  it("既存入力の value / unit を item 単位で保持する（手入力優先）", () => {
    const current = [{ item: "内容量", value: "500", unit: "g", requirement: "" }];
    const merged = mergeGenreAttributes(current, recommended);
    expect(merged[0]).toEqual({ item: "内容量", value: "500", unit: "g", requirement: "必須" });
  });

  it("既存の unit が空なら推奨単位を採用する", () => {
    const current = [{ item: "内容量", value: "500", unit: "", requirement: "" }];
    const merged = mergeGenreAttributes(current, recommended);
    expect(merged[0].unit).toBe("ml");
  });

  it("推奨に無い既存項目は落ち、requirement は常に推奨側を採用する", () => {
    const current = [
      { item: "独自項目", value: "x", unit: "", requirement: "必須" },
      { item: "賞味期限", value: "90", unit: "日", requirement: "でたらめ" },
    ];
    const merged = mergeGenreAttributes(current, recommended);
    expect(merged.map((a) => a.item)).toEqual(["内容量", "原産国/製造国", "賞味期限"]);
    expect(merged[2]).toEqual({ item: "賞味期限", value: "90", unit: "日", requirement: "任意" });
  });

  it("フォーム入力途中の値（フィールド optional）も許容する（ProductForm の watch 出力）", () => {
    const current = [{ item: "内容量", value: undefined, unit: undefined }];
    const merged = mergeGenreAttributes(current, recommended);
    expect(merged[0]).toEqual({ item: "内容量", value: "", unit: "ml", requirement: "必須" });
  });

  it("推奨属性が空なら空配列（呼び出し側が既存維持を判断する）", () => {
    expect(mergeGenreAttributes([{ item: "a", value: "1", unit: "" }], [])).toEqual([]);
  });
});

describe("applyCategoryAutofill が mergeGenreAttributes と同じ規則を使う（二重実装の解消）", () => {
  const attrs = [genreAttr("内容量", "ml", "必須"), genreAttr("原産国/製造国")];

  it("商品共通の属性: applyCategoryAutofill の結果 = mergeGenreAttributes の結果", () => {
    const p = makeProduct({
      attributes: [{ item: "内容量", value: "720", unit: "", requirement: "" }],
    });
    const { product } = applyCategoryAutofill(p, attrs, null);
    expect(product.attributes).toEqual(
      mergeGenreAttributes(p.attributes, genreAttributesToInputs(attrs)),
    );
    expect(product.attributes[0]).toEqual({ item: "内容量", value: "720", unit: "ml", requirement: "必須" });
  });

  it("variants 側の属性にも同じ規則が適用される", () => {
    const p = makeProduct({
      variants: [
        {
          sku_manage_number: "s-1",
          ne_code: "s-1",
          jan_code: "4955028002542",
          selling_price: 100,
          tax_rate: 10 as const,
          quantity: 1,
          variation_value: "1本",
          shipping_type: "送料別",
          attributes: [{ item: "内容量", value: "500", unit: "g", requirement: "" }],
        },
      ],
    });
    const { product } = applyCategoryAutofill(p, attrs, null);
    expect(product.variants[0].attributes).toEqual(
      mergeGenreAttributes(p.variants[0].attributes, genreAttributesToInputs(attrs)),
    );
    expect(product.variants[0].attributes[0].value).toBe("500"); // 手入力保持
    expect(product.variants[0].attributes[0].unit).toBe("g");
  });
});
