import { describe, it, expect } from "vitest";
import { ProductInputSchema, makeProduct } from "../product/schema";
import {
  TEMPLATE_EXCLUDED_FIELDS,
  applyTemplateToProduct,
  productToTemplateData,
} from "./template-data";

/** 新規作成ページと同じ空デフォルト（applyTemplateToProduct の base）。 */
const emptyBase = () =>
  ProductInputSchema.parse({
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

describe("productToTemplateData（テンプレート保存用データ）", () => {
  it("商品固有の除外項目（NEコード・JAN・商品名・価格・variants・モール識別子など）が入らない", () => {
    const data = productToTemplateData(makeProduct());
    for (const key of TEMPLATE_EXCLUDED_FIELDS) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("共通設定（税率・配送・カテゴリ・属性・説明文など）は入る", () => {
    const p = makeProduct({
      description_pc: "<p>説明</p>",
      attributes: [{ item: "内容量", value: "720", unit: "ml", requirement: "必須" }],
    });
    const data = productToTemplateData(p);
    expect(data.tax_rate).toBe(10);
    expect(data.shipping_type).toBe("送料無料");
    expect(data.mall_category_id).toBe("402930");
    expect(data.store_category).toBe("沖縄のお酒");
    expect(data.description_pc).toBe("<p>説明</p>");
    expect(data.attributes).toEqual([
      { item: "内容量", value: "720", unit: "ml", requirement: "必須" },
    ]);
  });
});

describe("applyTemplateToProduct（新規商品への流し込み）", () => {
  it("NEコード・JAN・商品名・販売価格は base（空/デフォルトJAN/0）のまま", () => {
    const template = productToTemplateData(makeProduct());
    const applied = applyTemplateToProduct(template, emptyBase());
    expect(applied.ne_code).toBe("");
    expect(applied.jan_code).toBe("0000000000000");
    expect(applied.product_name).toBe("");
    expect(applied.display_name).toBe("");
    expect(applied.selling_price).toBe(0);
    expect(applied.cost_price).toBe(0);
    expect(applied.variants).toEqual([]);
  });

  it("税率・配送・カテゴリ・属性・説明文などが流し込まれる", () => {
    const src = makeProduct({
      tax_rate: 8,
      description_pc: "<p>共通説明</p>",
      keyword: "沖縄 お土産",
      attributes: [{ item: "内容量", value: "", unit: "ml", requirement: "必須" }],
    });
    const applied = applyTemplateToProduct(productToTemplateData(src), emptyBase());
    expect(applied.tax_rate).toBe(8);
    expect(applied.shipping_type).toBe("送料無料");
    expect(applied.mall_category_id).toBe("402930");
    expect(applied.yahoo_category_id).toBe("41383");
    expect(applied.store_category).toBe("沖縄のお酒");
    expect(applied.description_pc).toBe("<p>共通説明</p>");
    expect(applied.keyword).toBe("沖縄 お土産");
    expect(applied.attributes).toEqual([
      { item: "内容量", value: "", unit: "ml", requirement: "必須" },
    ]);
  });

  it("product_type は流し込まれ、is_single/is_set は parse で再導出される", () => {
    const src = makeProduct({ product_type: "セット商品" });
    const applied = applyTemplateToProduct(productToTemplateData(src), emptyBase());
    expect(applied.product_type).toBe("セット商品");
    expect(applied.is_set).toBe(true);
    expect(applied.is_single).toBe(false);
  });

  it("汚れた template_data（未知キー・ne_code等の除外項目の混入）でも除外が効き、未知キーは落ちる", () => {
    const dirty: Record<string, unknown> = {
      ...productToTemplateData(makeProduct()),
      ne_code: "evil-001", // 除外項目の混入
      selling_price: 99999, // 除外項目の混入
      rakuten_manage_number: "evil", // モール識別子の混入
      mall_listed: { rakuten: true }, // 掲載状況の混入
      unknown_key: "???", // 未知キー
    };
    const applied = applyTemplateToProduct(dirty, emptyBase());
    expect(applied.ne_code).toBe("");
    expect(applied.selling_price).toBe(0);
    expect(applied.rakuten_manage_number).toBe("");
    expect(applied.mall_listed).toEqual({});
    expect(applied).not.toHaveProperty("unknown_key");
  });

  it("空の template_data なら base がそのまま返る", () => {
    const applied = applyTemplateToProduct({}, emptyBase());
    expect(applied).toEqual(emptyBase());
  });
});
