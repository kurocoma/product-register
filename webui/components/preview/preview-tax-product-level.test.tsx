import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { makeProduct } from "@/lib/product/schema";
import { YahooPreview } from "./YahooPreview";
import { ShopifyPreview } from "./ShopifyPreview";

afterEach(cleanup);

/** 税率は商品レベルが正（260715）。variant 税率が古い10%のままでも
 * プレビューの税込表示は商品税率8%で計算する（RakutenPreview と同じ設計判断）。 */
const product = makeProduct({
  tax_rate: 8,
  variants: [
    { sku_manage_number: "a-1", ne_code: "a-1", jan_code: "4589837520616", selling_price: 3912, tax_rate: 10, quantity: 1, shipping_type: "送料無料", variation_value: "マンゴー味" },
  ],
});

describe("YahooPreview 価格の税込表示（商品税率）", () => {
  it("3,912(税抜) ×1.08 四捨五入 = 4,225 を表示し、10%計算(4,303)は表示しない", () => {
    render(<YahooPreview product={product} peers={[]} />);
    expect(screen.getAllByText(/4,225/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/4,303/)).toBeNull();
  });
});

describe("ShopifyPreview 価格の税込表示（商品税率）", () => {
  it("¥4,225（Math.round・8%）を表示し、10%計算は表示しない", () => {
    render(<ShopifyPreview product={product} peers={[]} />);
    expect(screen.getAllByText(/4,225/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/4,303/)).toBeNull();
  });
});
