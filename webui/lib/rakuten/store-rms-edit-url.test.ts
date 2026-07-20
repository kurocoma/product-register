/** RMS 商品別編集ページURL生成（rakutenRmsItemEditUrl）のテスト（260720依頼: 実URL形式反映）。 */
import { describe, expect, it } from "vitest";

import { RAKUTEN_RMS_SHOP_ID, rakutenRmsItemEditUrl } from "./store";

describe("rakutenRmsItemEditUrl", () => {
  it("ユーザー実測の形式どおりに組み立てる", () => {
    expect(rakutenRmsItemEditUrl("235545", "r122-1")).toBe(
      "https://item.rms.rakuten.co.jp/rms-sku/shops/235545/item/edit/r122-1",
    );
  });

  it("管理番号が未設定・空白なら null（リンクを出さない）", () => {
    expect(rakutenRmsItemEditUrl("235545", "")).toBeNull();
    expect(rakutenRmsItemEditUrl("235545", "  ")).toBeNull();
    expect(rakutenRmsItemEditUrl("235545", undefined)).toBeNull();
    expect(rakutenRmsItemEditUrl("235545", null)).toBeNull();
  });

  it("店舗IDの既定値は 235545（実URLから確認）", () => {
    expect(RAKUTEN_RMS_SHOP_ID).toBe("235545");
  });
});
