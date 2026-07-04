import { describe, it, expect } from "vitest";
import { makeProduct } from "./schema";
import { applyCategoryAutofill } from "./category-autofill";
import type { GenreAttribute } from "./genre-attributes";
import { genreAttributesToInputs } from "./genre-attributes";
import type { YahooCategoryMapping } from "./category-mapping";

/** rakuten_genre_attributes 相当の推奨属性（products/new が使うのと同じ形）。 */
const ATTRS: GenreAttribute[] = [
  { item_name: "総入数", requirement: "必須", recommended_unit: "本", unit_choices: "本|袋", has_unit: true, sort_order: 1 },
  { item_name: "内容量", requirement: "任意", recommended_unit: "ml", unit_choices: "ml|L", has_unit: true, sort_order: 2 },
];

const YAHOO: YahooCategoryMapping = {
  yahoo_category_id: "13457",
  yahoo_category_name: "ソフトドリンク、ジュース",
  yahoo_path: "食品、飲料、製菓＞ソフトドリンク、ジュース",
  confidence: "high",
};

describe("applyCategoryAutofill（モール基本カテゴリID由来の自動補完・手入力優先）", () => {
  it("属性が未入力なら推奨属性（項目・単位）を genreAttributesToInputs と同一形で設定する", () => {
    const p = makeProduct({ attributes: [] });
    const { product, filled } = applyCategoryAutofill(p, ATTRS, null);
    expect(filled.attributes).toBe(true);
    expect(product.attributes).toEqual(genreAttributesToInputs(ATTRS));
    expect(product.attributes.map((a) => a.item)).toEqual(["総入数", "内容量"]);
    expect(product.attributes.map((a) => a.unit)).toEqual(["本", "ml"]);
    expect(product.attributes.map((a) => a.requirement)).toEqual(["必須", "任意"]);
  });

  it("手入力済みの属性値・単位は item 単位で保持する（products/new の読み込みと同じ規則）", () => {
    const p = makeProduct({
      attributes: [{ item: "総入数", value: "6", unit: "袋", requirement: "" }],
    });
    const { product } = applyCategoryAutofill(p, ATTRS, null);
    expect(product.attributes).toHaveLength(2);
    expect(product.attributes[0]).toEqual({ item: "総入数", value: "6", unit: "袋", requirement: "必須" });
    expect(product.attributes[1].item).toBe("内容量");
    expect(product.attributes[1].value).toBe("");
  });

  it("多SKU（variants[]）商品は各SKUの属性にも補完する（楽天はSKU単位で属性を送るため）", () => {
    const p = makeProduct({
      variants: [
        { ne_code: "a009-4916-1", selling_price: 200, quantity: 1 },
        { ne_code: "a009-4916-6", selling_price: 1080, quantity: 6, attributes: [{ item: "総入数", value: "6", unit: "本", requirement: "" }] },
      ],
    });
    const { product } = applyCategoryAutofill(p, ATTRS, null);
    expect(product.variants[0].attributes.map((a) => a.item)).toEqual(["総入数", "内容量"]);
    expect(product.variants[0].attributes[0].value).toBe(""); // 未入力SKUは項目・単位だけ
    expect(product.variants[1].attributes[0]).toEqual({ item: "総入数", value: "6", unit: "本", requirement: "必須" }); // 手入力値は保持
  });

  it("YahooカテゴリID・パスは空欄のときだけ補完する", () => {
    const p = makeProduct({ yahoo_category_id: "", yahoo_path: "" });
    const { product, filled } = applyCategoryAutofill(p, [], YAHOO);
    expect(filled.yahoo).toBe(true);
    expect(product.yahoo_category_id).toBe("13457");
    expect(product.yahoo_path).toBe("食品、飲料、製菓＞ソフトドリンク、ジュース");
  });

  it("手入力のYahooカテゴリIDは上書きしない（手入力優先）", () => {
    const p = makeProduct({ yahoo_category_id: "99999", yahoo_path: "手入力パス" });
    const { product, filled } = applyCategoryAutofill(p, [], YAHOO);
    expect(product.yahoo_category_id).toBe("99999");
    expect(product.yahoo_path).toBe("手入力パス");
    expect(filled.yahoo).toBe(false);
  });

  it("推奨属性なし・マッピングなしなら何も変えない", () => {
    const p = makeProduct();
    const { product, filled } = applyCategoryAutofill(p, [], null);
    expect(product).toEqual(p);
    expect(filled).toEqual({ attributes: false, yahoo: false });
  });
});
