import { describe, it, expect } from "vitest";
import { makeProduct } from "./schema";
import { yahooItemsForProduct } from "./yahoo-split";
import { YahooConverter } from "@/lib/converters/yahoo";

/** バリエーションキー統合で作られる形の統合商品（2SKU: 単品+6本セット）。 */
function unified(overrides: Parameters<typeof makeProduct>[0] = {}) {
  return makeProduct({
    ne_code: "a009-4916-1",
    jan_code: "4514603474916",
    maker_code: "a009",
    tax_rate: 8,
    selling_price: 200,
    shipping_type: "送料別",
    variation_key: "レモネード500",
    rakuten_manage_number: "a009-4916",
    unit: "本",
    variants: [
      {
        sku_manage_number: "a009-4916-1",
        ne_code: "a009-4916-1",
        jan_code: "4514603474916",
        selling_price: 200,
        tax_rate: 8,
        quantity: 1,
        variation_value: "1本",
        shipping_type: "送料別",
      },
      {
        sku_manage_number: "a009-4916-6",
        ne_code: "a009-4916-6",
        jan_code: "4514603474917",
        selling_price: 1080,
        tax_rate: 8,
        quantity: 6,
        variation_value: "6本",
        shipping_type: "送料無料",
      },
    ],
    ...overrides,
  });
}

describe("yahooItemsForProduct（Yahoo は統合商品を SKU ごとに分ける）", () => {
  it("フラット商品（variants なし）はそのまま [p] を返す（展開しない）", () => {
    const p = makeProduct();
    const items = yahooItemsForProduct(p);
    expect(items).toHaveLength(1);
    expect(items[0]).toBe(p); // 同一オブジェクト = コピーすら作らない
  });

  it("variants 1件の商品も展開しない（[p] のまま）", () => {
    const p = unified();
    p.variants = [p.variants[0]];
    const items = yahooItemsForProduct(p);
    expect(items).toHaveLength(1);
    expect(items[0]).toBe(p);
  });

  it("variants 2件以上は SKU ごとの擬似商品に展開する（SKU固有項目は variant 由来）", () => {
    const items = yahooItemsForProduct(unified());
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.ne_code)).toEqual(["a009-4916-1", "a009-4916-6"]);
    expect(items.map((i) => i.jan_code)).toEqual(["4514603474916", "4514603474917"]);
    expect(items.map((i) => i.selling_price)).toEqual([200, 1080]);
    expect(items.map((i) => i.quantity)).toEqual([1, 6]);
    expect(items.map((i) => i.shipping_type)).toEqual(["送料別", "送料無料"]);
    expect(items.map((i) => i.tax_rate)).toEqual([8, 8]);
    expect(items.map((i) => i.product_type)).toEqual(["単品", "セット商品"]);
    // 展開後はフラット商品と同形（variants は空）
    expect(items.every((i) => i.variants.length === 0)).toBe(true);
  });

  it("商品ページ共通項目（商品名・説明・カテゴリ・grouping）は商品側の値を引き継ぐ", () => {
    const p = unified({
      description_pc: "<p>共通説明</p>",
      yahoo_grouping_enabled: true,
      yahoo_variation_title: "数量",
    });
    const items = yahooItemsForProduct(p);
    for (const i of items) {
      expect(i.product_name).toBe(p.product_name);
      expect(i.display_name).toBe(p.display_name);
      expect(i.description_pc).toBe("<p>共通説明</p>");
      expect(i.mall_category_id).toBe(p.mall_category_id);
      expect(i.yahoo_category_id).toBe(p.yahoo_category_id);
      expect(i.yahoo_path).toBe(p.yahoo_path);
      // grouping フィールドの保持
      expect(i.yahoo_grouping_enabled).toBe(true);
      expect(i.yahoo_variation_title).toBe("数量");
      expect(i.unit).toBe("本");
    }
  });

  it("SKU別表示価格: variant.display_price があればそれ、無ければ 0（販売価格連動）", () => {
    const p = unified();
    p.variants[0].display_price = 250;
    const items = yahooItemsForProduct(p);
    expect(items[0].display_price).toBe(250);
    expect(items[1].display_price).toBe(0); // フラット商品と同じ「販売価格連動」規則
  });

  it("SKU に属性があれば SKU の値、無ければ商品共通の属性を使う", () => {
    const p = unified({
      attributes: [{ item: "内容量", value: "500", unit: "ml", requirement: "必須" }],
    });
    p.variants[1].attributes = [{ item: "内容量", value: "3000", unit: "ml", requirement: "必須" }];
    const items = yahooItemsForProduct(p);
    expect(items[0].attributes[0].value).toBe("500"); // 商品共通へフォールバック
    expect(items[1].attributes[0].value).toBe("3000"); // SKU 側優先
  });
});

describe("Yahoo CSV との統合（統合商品は SKU 行数分の行になる）", () => {
  const conv = new YahooConverter();

  it("展開してから変換すると SKU ごとに1行（code/price/jan/送料が SKU 別）", () => {
    const rows = conv.convert(yahooItemsForProduct(unified()));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r["code"])).toEqual(["a009-4916-1", "a009-4916-6"]);
    expect(rows.map((r) => r["price"])).toEqual(["216", "1166"]); // 200*1.08 / 1080*1.08
    expect(rows.map((r) => r["jan"])).toEqual(["4514603474916", "4514603474917"]);
    expect(rows.map((r) => r["ship-weight"])).toEqual(["1", "100"]); // 送料別 / 送料無料
    expect(rows.map((r) => r["delivery"])).toEqual(["0", "1"]);
  });

  it("grouping 有効時は展開後も同じ grouping-id を共有し variation1-name が SKU 別になる", () => {
    const p = unified({ yahoo_grouping_enabled: true, yahoo_variation_title: "数量" });
    const rows = conv.convert(yahooItemsForProduct(p));
    expect(rows.map((r) => r["grouping-id"])).toEqual(["a009-4916", "a009-4916"]);
    expect(rows.map((r) => r["variation1-name"])).toEqual(["1本", "6本セット"]);
  });

  it("既定挙動は不変: 統合商品を直接渡すと従来どおり variants[0] 代表の1行（opt-in の証明）", () => {
    const rows = conv.convert([unified()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["code"]).toBe("a009-4916-1");
  });

  it("フラット商品は展開してもしなくても同一出力（後方互換）", () => {
    const p = makeProduct();
    expect(conv.convert(yahooItemsForProduct(p))).toEqual(conv.convert([p]));
  });
});
