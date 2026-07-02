import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { mallRegistrationDone } from "./new-product-checklist";

/** 登録ステップ6「モール登録」の達成判定。従来は done:false 固定で常に未完了表示だった。
 * 掲載状況の単一源泉 mallPresence（mall_listed + 楽天は管理番号フォールバック）に揃える。 */
describe("mallRegistrationDone — 登録ステップ6の達成判定", () => {
  it("未掲載の新規商品では false", () => {
    expect(mallRegistrationDone(makeProduct())).toBe(false);
  });
  it("mall_listed.rakuten=true で true", () => {
    expect(mallRegistrationDone(makeProduct({ mall_listed: { rakuten: true } }))).toBe(true);
  });
  it("mall_listed.yahoo=true で true", () => {
    expect(mallRegistrationDone(makeProduct({ mall_listed: { yahoo: true } }))).toBe(true);
  });
  it("楽天の実管理番号があれば掲載扱い（後方互換）", () => {
    expect(mallRegistrationDone(makeProduct({ rakuten_manage_number: "r0101-1" }))).toBe(true);
  });
});
