import { describe, it, expect } from "vitest";
import { parseYahooItem } from "./yahoo-item-parser";

/** Yahoo 定期購入 — 取込側（260711修正依頼-Task7「定期購入のタブもモールから取り込みで取得」）。
 * getItem の Subscription* 5タグ → ProductInput の Yahoo 用フィールド
 * （資料 yahoo-subscription-product-registration.md §8 のマッピング）。
 * SubscriptionPrice はストア税込設定前提 → 税抜へ変換して保持（既存 Price と同じ扱い）。 */

function xmlWith(tags: string): string {
  return `<Result><ItemCode>a-1</ItemCode><Name><![CDATA[定期テスト商品]]></Name><Price>4378</Price><TaxrateType>0.1</TaxrateType>${tags}</Result>`;
}

describe("parseYahooItem — Subscription* 5タグの取込", () => {
  it("5タグすべてを Yahoo 用フィールドへ取り込む（価格は税込4378→税抜3980と同率で変換）", () => {
    const out = parseYahooItem(
      xmlWith(
        "<SubscriptionType>1</SubscriptionType><SubscriptionPrice>3938</SubscriptionPrice><SubscriptionGroupIndex>3</SubscriptionGroupIndex><SubscriptionRecommendedCycle>1:30</SubscriptionRecommendedCycle><SubscriptionPointCode>2</SubscriptionPointCode>",
      ),
    );
    expect(out.yahoo_subscription_type).toBe(1);
    expect(out.yahoo_subscription_price).toBe(3580); // 3938 ÷ 1.10 = 3580（税抜）
    expect(out.yahoo_subscription_group_index).toBe(3);
    expect(out.yahoo_subscription_recommended_cycle).toBe("1:30");
    expect(out.yahoo_subscription_point_code).toBe(2);
  });

  it("税率8%（TaxrateType=0.08）でも税抜へ戻す", () => {
    const xml = `<Result><ItemCode>a-1</ItemCode><Price>4298</Price><TaxrateType>0.08</TaxrateType><SubscriptionType>1</SubscriptionType><SubscriptionPrice>3866</SubscriptionPrice><SubscriptionGroupIndex>1</SubscriptionGroupIndex></Result>`;
    const out = parseYahooItem(xml);
    expect(out.yahoo_subscription_price).toBe(3580); // 3866 ÷ 1.08 = 3580（税抜）
  });

  it("TaxrateType が無ければ fallbackTaxRate で変換する（送受対称）", () => {
    const xml = `<Result><ItemCode>a-1</ItemCode><SubscriptionType>1</SubscriptionType><SubscriptionPrice>3866</SubscriptionPrice></Result>`;
    const out = parseYahooItem(xml, { fallbackTaxRate: 8 });
    expect(out.yahoo_subscription_price).toBe(3580);
  });

  it("type=2（定期購入のみ）も取り込む", () => {
    const out = parseYahooItem(xmlWith("<SubscriptionType>2</SubscriptionType><SubscriptionPrice>4378</SubscriptionPrice><SubscriptionGroupIndex>20</SubscriptionGroupIndex>"));
    expect(out.yahoo_subscription_type).toBe(2);
    expect(out.yahoo_subscription_group_index).toBe(20);
  });

  it("SubscriptionType=0（定期なし）は関連4項目を未設定（0/空）で埋める（diff が比較できる形）", () => {
    const out = parseYahooItem(xmlWith("<SubscriptionType>0</SubscriptionType>"));
    expect(out.yahoo_subscription_type).toBe(0);
    expect(out.yahoo_subscription_price).toBe(0);
    expect(out.yahoo_subscription_group_index).toBe(0);
    expect(out.yahoo_subscription_recommended_cycle).toBe("");
    expect(out.yahoo_subscription_point_code).toBe(0);
  });

  it("SubscriptionType タグ自体が無ければ5フィールドとも設定しない（取得不能項目は diff 対象外）", () => {
    const out = parseYahooItem(xmlWith(""));
    expect(out.yahoo_subscription_type).toBeUndefined();
    expect(out.yahoo_subscription_price).toBeUndefined();
    expect(out.yahoo_subscription_group_index).toBeUndefined();
    expect(out.yahoo_subscription_recommended_cycle).toBeUndefined();
    expect(out.yahoo_subscription_point_code).toBeUndefined();
  });

  it("Taxable=0（非課税）は SubscriptionPrice を変換せずそのまま保持する", () => {
    const xml = `<Result><ItemCode>a-1</ItemCode><Price>4378</Price><TaxrateType>0.1</TaxrateType><Taxable>0</Taxable><SubscriptionType>1</SubscriptionType><SubscriptionPrice>3938</SubscriptionPrice><SubscriptionGroupIndex>1</SubscriptionGroupIndex></Result>`;
    const out = parseYahooItem(xml);
    expect(out.yahoo_subscription_price).toBe(3938);
  });
});
