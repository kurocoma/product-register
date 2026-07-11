import { describe, it, expect } from "vitest";
import { xmlToEditItemParams, buildYahooUpdateParams } from "./yahoo-patch";
import { makeProduct } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";

/** Yahoo 定期購入 — ラウンドトリップ・無効化（260711修正依頼-Task7）。
 * 資料 yahoo-subscription-product-registration.md §5・§9:
 * - editItem は未送信項目を既定値で上書きするため、無関係な更新でも既存の定期購入5項目を再送して保持する
 * - type を 0 へ変える更新では price/group/cycle/point を送信値から削除する（残すと it-14107/14110/14123）
 * - 5項目がラウンドトリップ可能になったため detectAdvanced は subscription を 409 対象にしない */

const SELLER = { sellerId: "teststore" };

/** 定期購入 type=1 が設定済みの getItem XML（税込 3938 = 税抜 3580 @10%）。 */
const XML_TYPE1 = `<Result>
<ItemCode>a-1</ItemCode>
<Name><![CDATA[定期テスト商品]]></Name>
<ProductCategory>41383</ProductCategory>
<PathList><Path><![CDATA[食品]]></Path></PathList>
<Price>4378</Price>
<TaxrateType>0.1</TaxrateType>
<SubscriptionType>1</SubscriptionType>
<SubscriptionPrice>3938</SubscriptionPrice>
<SubscriptionGroupIndex>3</SubscriptionGroupIndex>
<SubscriptionRecommendedCycle>1:30</SubscriptionRecommendedCycle>
<SubscriptionPointCode>2</SubscriptionPointCode>
</Result>`;

describe("xmlToEditItemParams — 定期購入5項目のラウンドトリップ", () => {
  it("getItem の5タグを editItem パラメータへ転記する（criteria C1）", () => {
    const { params } = xmlToEditItemParams(XML_TYPE1, SELLER.sellerId);
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_price).toBe("3938"); // 転記はそのまま（税変換しない）
    expect(params.subscription_group_index).toBe("3");
    expect(params.subscription_recommended_cycle).toBe("1:30");
    expect(params.subscription_point_code).toBe("2");
  });
  it("SubscriptionType=0 の商品は関連4タグの残骸を転記しない（it-14107 予防）", () => {
    const xml = `<Result><ItemCode>a-1</ItemCode><SubscriptionType>0</SubscriptionType><SubscriptionGroupIndex>3</SubscriptionGroupIndex><SubscriptionPointCode>2</SubscriptionPointCode></Result>`;
    const { params } = xmlToEditItemParams(xml, SELLER.sellerId);
    expect(params.subscription_type).toBe("0");
    expect(params.subscription_group_index).toBeUndefined();
    expect(params.subscription_point_code).toBeUndefined();
  });
});

describe("detectAdvanced — subscription の409解除（criteria C3）", () => {
  it("定期購入設定済み（SubscriptionType=1）でも advanced に subscription を出さない", () => {
    const { advanced } = xmlToEditItemParams(XML_TYPE1, SELLER.sellerId);
    expect(advanced).not.toContain("subscription");
  });
  it("未対応の inscription は引き続き advanced として検出する（409 中止の対象のまま）", () => {
    const xml = `<Result><ItemCode>a-1</ItemCode><SubscriptionType>1</SubscriptionType><Inscriptions><Inscription><Number>1</Number></Inscription></Inscriptions></Result>`;
    const { advanced } = xmlToEditItemParams(xml, SELLER.sellerId);
    expect(advanced).toContain("inscriptions");
    expect(advanced).not.toContain("subscription");
  });
});

describe("buildYahooUpdateParams — 定期購入の保持と更新", () => {
  it("無関係な項目（商品名）だけの更新でも定期購入5項目を保持する（criteria C1）", () => {
    const p = makeProduct({ display_name: "新しい商品名" });
    const changed: ChangedField[] = [{ field: "display_name", before: "旧", after: "新しい商品名" }];
    const { params } = buildYahooUpdateParams(XML_TYPE1, changed, p, SELLER);
    expect(params.name).toBe("新しい商品名");
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_price).toBe("3938");
    expect(params.subscription_group_index).toBe("3");
    expect(params.subscription_recommended_cycle).toBe("1:30");
    expect(params.subscription_point_code).toBe("2");
  });

  it("type→0 の更新では price/group/cycle/point の4項目を送信値から削除する（criteria C2）", () => {
    const p = makeProduct({ yahoo_subscription_type: 0 });
    const changed: ChangedField[] = [{ field: "yahoo_subscription_type", before: 1, after: 0 }];
    const { params } = buildYahooUpdateParams(XML_TYPE1, changed, p, SELLER);
    expect(params.subscription_type).toBe("0");
    // 土台（XML）のラウンドトリップ値が残ると it-14107/14110/14123 になる
    expect(params.subscription_price).toBeUndefined();
    expect(params.subscription_group_index).toBeUndefined();
    expect(params.subscription_recommended_cycle).toBeUndefined();
    expect(params.subscription_point_code).toBeUndefined();
  });

  it("定期価格だけの変更は税込へ変換して上書きし、type/group は土台の値を維持する", () => {
    const p = makeProduct({
      tax_rate: 10,
      yahoo_subscription_type: 1,
      yahoo_subscription_price: 4000, // 税抜 → 税込 4400
      yahoo_subscription_group_index: 3,
      yahoo_subscription_recommended_cycle: "1:30",
      yahoo_subscription_point_code: 2,
    });
    const changed: ChangedField[] = [{ field: "yahoo_subscription_price", before: 3580, after: 4000 }];
    const { params } = buildYahooUpdateParams(XML_TYPE1, changed, p, SELLER);
    expect(params.subscription_price).toBe("4400");
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_group_index).toBe("3");
  });

  it("point を 0（未設定）へ変える更新はパラメータごと削除する（空文字を送らない）", () => {
    const p = makeProduct({
      yahoo_subscription_type: 1,
      yahoo_subscription_price: 3580,
      yahoo_subscription_group_index: 3,
      yahoo_subscription_point_code: 0,
    });
    const changed: ChangedField[] = [{ field: "yahoo_subscription_point_code", before: 2, after: 0 }];
    const { params } = buildYahooUpdateParams(XML_TYPE1, changed, p, SELLER);
    expect(params.subscription_point_code).toBeUndefined();
    // 他の定期項目は保持
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_price).toBe("3938");
  });

  it("定期なし商品（SubscriptionType=0 の土台）への新規設定は5項目を送信する", () => {
    const xml = `<Result><ItemCode>a-1</ItemCode><Name><![CDATA[X]]></Name><Price>4378</Price><TaxrateType>0.1</TaxrateType><SubscriptionType>0</SubscriptionType></Result>`;
    const p = makeProduct({
      tax_rate: 10,
      yahoo_subscription_type: 1,
      yahoo_subscription_price: 3580,
      yahoo_subscription_group_index: 5,
      yahoo_subscription_recommended_cycle: "2:1",
      yahoo_subscription_point_code: 3,
    });
    const changed: ChangedField[] = [
      { field: "yahoo_subscription_type", before: 0, after: 1 },
      { field: "yahoo_subscription_price", before: 0, after: 3580 },
      { field: "yahoo_subscription_group_index", before: 0, after: 5 },
      { field: "yahoo_subscription_recommended_cycle", before: "", after: "2:1" },
      { field: "yahoo_subscription_point_code", before: 0, after: 3 },
    ];
    const { params } = buildYahooUpdateParams(xml, changed, p, SELLER);
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_price).toBe("3938");
    expect(params.subscription_group_index).toBe("5");
    expect(params.subscription_recommended_cycle).toBe("2:1");
    expect(params.subscription_point_code).toBe("3");
  });
});
