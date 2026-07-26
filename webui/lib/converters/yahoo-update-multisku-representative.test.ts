import { describe, it, expect } from "vitest";
import { buildYahooUpdateParams } from "./yahoo-patch";
import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";

// 多SKUページの商品を Yahoo へ「反映(update)」するときの代表SKU（260726実件の回帰テスト）。
// YahooConverter は CSV/登録と共通で variants[0] を代表行にするため、多SKU商品をそのまま渡すと
// caption の画像一覧（商品コード_N.jpg）や送料アイコンが別SKUの値になり、
// r124（Yahoo商品コード r124-3）の説明文に r124-1 の画像が入る事故になっていた。

function makeProduct(overrides: Partial<ProductInput> = {}): ProductInput {
  return ProductInputSchema.parse({
    ne_code: "r124-3",
    jan_code: "4900000000003",
    maker_code: "m",
    product_type: "単品",
    quantity: 3,
    product_name: "テスト",
    display_name: "テスト 3個",
    tax_rate: 8,
    cost_price: 0,
    selling_price: 7083,
    shipping_type: "送料無料",
    image_count: 2,
    delivery_method: 1,
    lead_time: 1,
    mall_category_id: "0",
    yahoo_category_id: "13457",
    yahoo_path: "テスト",
    description_pc: "<p>説明</p>",
    // 楽天API応答順のまま = 先頭は自分ではない別SKU（1個売り・送料別）
    variants: [
      { sku_manage_number: "r124-1", ne_code: "r124-1", jan_code: "4900000000001", selling_price: 2486, tax_rate: 8, quantity: 1, variation_value: "", shipping_type: "送料別" },
      { sku_manage_number: "r124-3", ne_code: "r124-3", jan_code: "4900000000003", selling_price: 7083, tax_rate: 8, quantity: 3, variation_value: "", shipping_type: "送料無料" },
      { sku_manage_number: "r124-5", ne_code: "r124-5", jan_code: "4900000000005", selling_price: 11184, tax_rate: 8, quantity: 5, variation_value: "", shipping_type: "送料別" },
    ],
    ...overrides,
  });
}

const XML = `<?xml version="1.0"?><ResultSet><Result>
<ItemCode>r124-3</ItemCode><Name>旧名</Name><Price>7000</Price>
<ProductCategory>13457</ProductCategory><PathList><Path><![CDATA[テスト]]></Path></PathList>
<Caption><![CDATA[<p>旧説明</p>]]></Caption><Display>1</Display>
</Result></ResultSet>`;

describe("buildYahooUpdateParams — 多SKU商品は自SKUを代表にする", () => {
  it("caption の画像一覧は自分の商品コード(r124-3)を使う", () => {
    const p = makeProduct();
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "seller" });
    const codes = [...params.caption.matchAll(/\/lib\/[^/]+\/([^"'\s>]+?)_\d+\.jpg/gi)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect([...new Set(codes)]).toEqual(["r124-3"]); // r124-1 が混ざったら不合格
  });

  it("送料アイコン/重量は自SKUの送料区分（送料無料）で決まる", () => {
    const { params } = buildYahooUpdateParams(XML, [], makeProduct(), { sellerId: "seller" });
    expect(params.ship_weight).toBe("100");
    expect(params.delivery).toBe("1");
  });

  it("自SKUが variants に無い場合は従来どおり先頭SKUを代表にする", () => {
    const p = makeProduct({ ne_code: "zzz-unknown" });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "seller" });
    expect(params.ship_weight).toBe("1"); // 先頭 r124-1 = 送料別
  });

  it("単一SKU商品は挙動が変わらない", () => {
    const p = makeProduct({ ne_code: "r124-3", variants: [] });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "seller" });
    const codes = [...params.caption.matchAll(/\/lib\/[^/]+\/([^"'\s>]+?)_\d+\.jpg/gi)].map((m) => m[1]);
    expect([...new Set(codes)]).toEqual(["r124-3"]);
    expect(params.ship_weight).toBe("100");
  });
});
