import { describe, expect, it } from "vitest";
import { buildYahooUpdateParams } from "./yahoo-patch";
import { makeProduct } from "@/lib/product/schema";

/** update経路のアプリ管理項目上書き（260724・r8901-1実件）:
 * caption(imgList付き)・送料無料アイコン(ship_weight/delivery)・定期購入のDB正化。 */

const XML = `<Result><ItemCode>zzz-1</ItemCode><Price>1000</Price>
<Caption><![CDATA[旧キャプション]]></Caption>
<ShipWeight>1</ShipWeight><Delivery>0</Delivery>
<SubscriptionType>0</SubscriptionType><SubscriptionRecommendedCycle>0</SubscriptionRecommendedCycle>
</Result>`;

describe("caption は imgList 付きビルダー値で常に上書き", () => {
  it("差分に description_pc が無くても imgList+説明文を送る（素の説明文で imgList が消える退行の防止）", () => {
    const p = makeProduct({ ne_code: "zzz-1", image_count: 3, description_pc: '<img src="https://image.rakuten.co.jp/x.jpg">説明' });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "s" });
    expect(params.caption.startsWith("<!--imgList-->")).toBe(true);
    expect(params.caption).toContain("shopping.c.yimg.jp/lib/okimarumarket/zzz-1_2.jpg");
    expect(params.caption).toContain("shopping.c.yimg.jp/lib/okimarumarket/zzz-1_3.jpg");
    // 説明文はダブルクォート→シングルクォート化して同梱
    expect(params.caption).toContain("<img src='https://image.rakuten.co.jp/x.jpg'>説明");
    expect(params.sp_additional).toBe(params.caption);
  });

  it("説明文が空ならラウンドトリップの caption を維持（空上書きしない）", () => {
    const p = makeProduct({ ne_code: "zzz-1", image_count: 0, description_pc: "" });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "s" });
    expect(params.caption).toBe("旧キャプション");
  });
});

describe("送料無料アイコン（ship_weight / delivery）は DB の shipping_type を正とする", () => {
  it("送料無料 → ship_weight=100 / delivery=1", () => {
    const p = makeProduct({ ne_code: "zzz-1", shipping_type: "送料無料" });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "s" });
    expect(params.ship_weight).toBe("100");
    expect(params.delivery).toBe("1");
  });
  it("送料別 → ship_weight=1 / delivery=0", () => {
    const p = makeProduct({ ne_code: "zzz-1", shipping_type: "送料別" });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "s" });
    expect(params.ship_weight).toBe("1");
    expect(params.delivery).toBe("0");
  });
});

describe("定期購入は DB（yahoo_subscription_*）を正とする", () => {
  it("type=0（未管理）はYahoo側の既存定期設定を保持する（criteria C1と同契約）", () => {
    const xmlType1 = XML.replace("<SubscriptionType>0</SubscriptionType>", "<SubscriptionType>1</SubscriptionType><SubscriptionPrice>3938</SubscriptionPrice><SubscriptionGroupIndex>3</SubscriptionGroupIndex>");
    const p = makeProduct({ ne_code: "zzz-1", yahoo_subscription_type: 0 });
    const { params } = buildYahooUpdateParams(xmlType1, [], p, { sellerId: "s" });
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_price).toBe("3938");
    expect(params.subscription_group_index).toBe("3");
  });

  it("type=1 は税込価格・グループ・サイクルを送る", () => {
    const p = makeProduct({
      ne_code: "zzz-1", tax_rate: 10,
      yahoo_subscription_type: 1, yahoo_subscription_price: 3520,
      yahoo_subscription_group_index: 1, yahoo_subscription_recommended_cycle: "2:1",
    });
    const { params } = buildYahooUpdateParams(XML, [], p, { sellerId: "s" });
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_price).toBe("3872"); // 3520(税抜)×10% → 税込
    expect(params.subscription_group_index).toBe("1");
    expect(params.subscription_recommended_cycle).toBe("2:1");
  });
});
