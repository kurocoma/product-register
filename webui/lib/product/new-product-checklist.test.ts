import { describe, it, expect } from "vitest";
import { ProductInputSchema, makeProduct } from "./schema";
import {
  newProductChecklist,
  missingRequiredItems,
  canAutoSaveNewProduct,
  JAN_PLACEHOLDER,
} from "./new-product-checklist";

/** 新規ページ(app/(main)/products/new/page.tsx)と同じ空デフォルト。 */
const emptyNewProduct = () =>
  ProductInputSchema.parse({
    ne_code: "",
    jan_code: JAN_PLACEHOLDER,
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

describe("newProductChecklist（新規商品の必須項目チェック）", () => {
  it("空の新規商品は必須項目がすべて不足と判定される", () => {
    const missing = missingRequiredItems(emptyNewProduct());
    const keys = missing.map((i) => i.key);
    expect(keys).toContain("ne_code");
    expect(keys).toContain("product_name");
    expect(keys).toContain("display_name");
    expect(keys).toContain("jan_code"); // プレースホルダJANは未入力扱い
    expect(keys).toContain("selling_price");
    expect(keys).toContain("mall_category_id");
  });

  it("JANのプレースホルダ(0000000000000)は未入力扱い、実JANは充足扱い", () => {
    const withPlaceholder = emptyNewProduct();
    expect(newProductChecklist(withPlaceholder).find((i) => i.key === "jan_code")?.done).toBe(false);

    const withRealJan = ProductInputSchema.parse({ ...withPlaceholder, jan_code: "4955028002542" });
    expect(newProductChecklist(withRealJan).find((i) => i.key === "jan_code")?.done).toBe(true);
  });

  it("楽天ジャンルIDは6桁数字のみ充足（5桁・空・非数値は不足）", () => {
    const check = (mall_category_id: string) =>
      newProductChecklist(makeProduct({ mall_category_id }))
        .find((i) => i.key === "mall_category_id")?.done;
    expect(check("402930")).toBe(true);
    expect(check("40293")).toBe(false);
    expect(check("")).toBe(false);
    expect(check("abc930")).toBe(false);
  });

  it("入力済みの商品(makeProduct)は必須不足なし", () => {
    expect(missingRequiredItems(makeProduct())).toEqual([]);
  });

  it("Yahooカテゴリと画像は任意（required=false）で必須不足には含めない", () => {
    const p = makeProduct({ yahoo_path: "", image_url_1: "" });
    const keys = missingRequiredItems(p).map((i) => i.key);
    expect(keys).not.toContain("yahoo_path");
    expect(keys).not.toContain("image_url_1");
    // ただしチェックリスト自体には表示される（誘導のため）
    const all = newProductChecklist(p);
    expect(all.find((i) => i.key === "yahoo_path")?.done).toBe(false);
    expect(all.find((i) => i.key === "image_url_1")?.done).toBe(false);
  });
});

describe("canAutoSaveNewProduct（新規時の自動保存開始条件）", () => {
  it("NEコードが空の間は自動保存を開始しない（エラー連発防止）", () => {
    expect(canAutoSaveNewProduct(emptyNewProduct())).toBe(false);
  });

  it("NEコードだけ入力されれば自動保存は開始できる（保存の必須=validateForSaveと同一源泉）", () => {
    const p = ProductInputSchema.parse({ ...emptyNewProduct(), ne_code: "t002-2542-1" });
    expect(canAutoSaveNewProduct(p)).toBe(true);
  });

  it("空白のみのNEコードは開始しない", () => {
    const p = ProductInputSchema.parse({ ...emptyNewProduct(), ne_code: "   " });
    expect(canAutoSaveNewProduct(p)).toBe(false);
  });
});
