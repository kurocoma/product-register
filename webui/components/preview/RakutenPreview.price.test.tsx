import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { makeProduct } from "@/lib/product/schema";
import { RakutenPreview } from "./RakutenPreview";

afterEach(cleanup);

/** 実測ベース（r7201 琉球すっぽんコラーゲンゼリー・8%・楽天は税別登録）の多SKU商品。
 * variant 側の tax_rate は意図的に古い値(10)にする: 楽天の実ページは商品レベル
 * payment.taxRate で税込計算し、「モール取込」も商品レベル税率のみ更新するため、
 * プレビューは商品側 tax_rate を使うことを固定する。 */
const product = makeProduct({
  tax_rate: 8,
  variants: [
    { sku_manage_number: "a-1", ne_code: "a-1", jan_code: "4582469493419", selling_price: 3912, tax_rate: 10, quantity: 1, shipping_type: "送料無料", variation_value: "マンゴー味" },
    { sku_manage_number: "a-2", ne_code: "a-2", jan_code: "4582469493426", selling_price: 7517, tax_rate: 10, quantity: 2, shipping_type: "送料無料", variation_value: "2箱セット" },
  ],
});

describe("RakutenPreview 価格の税込表示", () => {
  it("メイン価格は商品レベル税率で税込（切り捨て）表示する（税抜3,912 ×1.08 → 4,224）", () => {
    render(<RakutenPreview product={product} peers={[]} />);
    expect(screen.getAllByText(/4,224/).length).toBeGreaterThan(0);
  });

  it("SKU切替リストの価格も税込で表示する（税抜7,517 ×1.08 → 8,118円）", () => {
    render(<RakutenPreview product={product} peers={[]} />);
    expect(screen.getByText("8,118円")).toBeTruthy();
  });

  it("税抜のまま・variant側の古い税率(10%)での表示は残らない", () => {
    render(<RakutenPreview product={product} peers={[]} />);
    expect(screen.queryByText("3,912円")).toBeNull();  // 税抜のまま
    expect(screen.queryByText("7,517円")).toBeNull();  // 税抜のまま
    expect(screen.queryByText("4,303円")).toBeNull();  // 3,912×1.10 (variant税率で計算してしまった場合)
    expect(screen.queryByText("8,268円")).toBeNull();  // 7,517×1.10 (同上)
  });
});
