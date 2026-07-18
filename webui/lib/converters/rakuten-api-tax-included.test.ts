import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody } from "./rakuten-api";

/** 楽天登録の税区分（260715修正）。
 * 当店の楽天商品は税別登録（items.get の standardPrice = 税抜値、実ページは楽天側が税込計算）。
 * アプリの selling_price も全モール税抜統一のため、upsert は必ず taxIncluded: false（税別）で送る。
 * true で送ると税抜額が「税込価格」として登録され、実ページの表示価格が下がってしまう。 */
describe("buildRakutenUpsertBody payment（税別登録）", () => {
  it("taxIncluded: false（税別）で送る", () => {
    const body = buildRakutenUpsertBody(makeProduct({ tax_rate: 8 }));
    expect(body.payment).toEqual({ taxIncluded: false, taxRate: "0.08" });
  });

  it("税率10%は taxRate \"0.1\"", () => {
    const body = buildRakutenUpsertBody(makeProduct({ tax_rate: 10 }));
    expect(body.payment).toEqual({ taxIncluded: false, taxRate: "0.1" });
  });
});
