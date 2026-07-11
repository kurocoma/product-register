import { describe, it, expect } from "vitest";
import { YahooConverter } from "./yahoo";
import { parseYahooItem } from "./yahoo-item-parser";
import { buildYahooEditItemParams, validateEditItemParams } from "@/lib/yahoo/item-mapper";
import { makeProduct } from "@/lib/product/schema";

/** Yahoo 定期購入 — 送信側（260711修正依頼-Task7）。
 * 期待値は資料 yahoo-subscription-product-registration.md §5 の type 別ルール:
 * type=0 は subscription_type=0 のみ送信し関連4項目を送らない。type=1/2 は price(税込変換)・
 * group を送り、point=0 は省略（設定時のみ 1〜15）。 */

const OPTS = { sellerId: "teststore" };

describe("buildYahooEditItemParams — type=0（設定なし。既定値）", () => {
  it("subscription_type=0 のみ明示送信し、関連4項目を送らない", () => {
    const params = buildYahooEditItemParams(makeProduct(), OPTS);
    expect(params.subscription_type).toBe("0");
    expect(params.subscription_price).toBeUndefined();
    expect(params.subscription_group_index).toBeUndefined();
    expect(params.subscription_recommended_cycle).toBeUndefined();
    expect(params.subscription_point_code).toBeUndefined();
  });
});

describe("buildYahooEditItemParams — type=1（通常購入／定期購入）", () => {
  const p = makeProduct({
    selling_price: 3980, // 税抜 → price は税込 4378
    tax_rate: 10,
    yahoo_subscription_type: 1,
    yahoo_subscription_price: 3580, // 税抜 → 税込 3938
    yahoo_subscription_group_index: 3,
    yahoo_subscription_recommended_cycle: "2:1",
    yahoo_subscription_point_code: 0, // 未設定 → 省略
  });
  const params = buildYahooEditItemParams(p, OPTS);

  it("subscription_type=1 と price・group・cycle を送る", () => {
    expect(params.subscription_type).toBe("1");
    expect(params.subscription_group_index).toBe("3");
    expect(params.subscription_recommended_cycle).toBe("2:1");
  });
  it("subscription_price は通常価格と同じ税込変換（3580 税抜 → 3938 税込）", () => {
    expect(params.subscription_price).toBe("3938");
    expect(params.price).toBe("4378"); // 同一の税基準で比較可能
  });
  it("point=0（未設定）は subscription_point_code を省略する（送ると it-14126）", () => {
    expect(params.subscription_point_code).toBeUndefined();
  });
  it("point 設定時（1〜15）のみ送る", () => {
    const withPoint = buildYahooEditItemParams(
      makeProduct({ yahoo_subscription_type: 1, yahoo_subscription_price: 3580, yahoo_subscription_group_index: 3, yahoo_subscription_point_code: 5 }),
      OPTS,
    );
    expect(withPoint.subscription_point_code).toBe("5");
  });
  it("validateEditItemParams が正常系を通す", () => {
    expect(validateEditItemParams(params).ok).toBe(true);
  });
});

describe("buildYahooEditItemParams — type=2（定期購入のみ）", () => {
  it("定期価格 = 通常価格（同税抜額）なら送信可（税込でも同額になる）", () => {
    const p = makeProduct({
      selling_price: 3980,
      tax_rate: 10,
      yahoo_subscription_type: 2,
      yahoo_subscription_price: 3980,
      yahoo_subscription_group_index: 1,
    });
    const params = buildYahooEditItemParams(p, OPTS);
    expect(params.subscription_type).toBe("2");
    expect(params.subscription_price).toBe(params.price);
    expect(validateEditItemParams(params).ok).toBe(true);
  });
  it("定期価格 ≠ 通常価格は dry-run 検証で止まる（it-14105 前倒し）", () => {
    const p = makeProduct({
      selling_price: 3980,
      yahoo_subscription_type: 2,
      yahoo_subscription_price: 3580,
      yahoo_subscription_group_index: 1,
    });
    const valid = validateEditItemParams(buildYahooEditItemParams(p, OPTS));
    expect(valid.ok).toBe(false);
    if (!valid.ok) expect(valid.missing.some((m) => m.includes("同額"))).toBe(true);
  });
});

describe("buildYahooEditItemParams — 事前検証との統合（it-14104/14106 前倒し）", () => {
  it("type=1 で定期価格 > 通常価格 → invalid", () => {
    const p = makeProduct({
      selling_price: 3000,
      yahoo_subscription_type: 1,
      yahoo_subscription_price: 3500,
      yahoo_subscription_group_index: 1,
    });
    const valid = validateEditItemParams(buildYahooEditItemParams(p, OPTS));
    expect(valid.ok).toBe(false);
  });
  it("type=1 で group 未設定 → invalid（必須）", () => {
    const p = makeProduct({ yahoo_subscription_type: 1, yahoo_subscription_price: 3000 });
    const valid = validateEditItemParams(buildYahooEditItemParams(p, OPTS));
    expect(valid.ok).toBe(false);
    if (!valid.ok) expect(valid.missing.some((m) => m.includes("グループ管理番号"))).toBe(true);
  });
});

describe("税の往復（送信=税込 ↔ 取込=税抜。criteria B2）", () => {
  it.each([
    [10, 3580, 3938], // 3580 * 1.10 = 3938
    [8, 3580, 3866], // 3580 * 1.08 = 3866.4 → 四捨五入 3866
    [10, 1, 1], // 下限
    [8, 999, 1079], // 999 * 1.08 = 1078.92 → 1079
  ])("税率%d%%: 税抜%d円 → 送信%d円 → 取込で元の税抜額に戻る", (rate, exclusive, inclusive) => {
    const p = makeProduct({
      tax_rate: rate as 8 | 10,
      selling_price: 99999,
      yahoo_subscription_type: 1,
      yahoo_subscription_price: exclusive,
      yahoo_subscription_group_index: 1,
    });
    const params = buildYahooEditItemParams(p, OPTS);
    expect(params.subscription_price).toBe(String(inclusive));
    // getItem 相当の XML（送信した税込値がそのまま返る想定）から取り込むと元の税抜へ戻る
    const xml = `<Result><ItemCode>a-1</ItemCode><Price>${params.price}</Price><TaxrateType>${rate / 100}</TaxrateType><SubscriptionType>1</SubscriptionType><SubscriptionPrice>${inclusive}</SubscriptionPrice><SubscriptionGroupIndex>1</SubscriptionGroupIndex></Result>`;
    const parsed = parseYahooItem(xml);
    expect(parsed.yahoo_subscription_price).toBe(exclusive);
  });
});

describe("YahooConverter（CSV）— 定期購入5列", () => {
  it("type=0 は5列とも空（既存CSV出力と同一 = フィクスチャ互換）", () => {
    const row = new YahooConverter().convert([makeProduct()])[0];
    expect(row["subscription-type"]).toBe("");
    expect(row["subscription-price"]).toBe("");
    expect(row["subscription-group-index"]).toBe("");
    expect(row["subscription-recommended-cycle"]).toBe("");
    expect(row["subscription-point-code"]).toBe("");
  });
  it("type=1 は5列を生成（価格は税込変換・point=0 は空）", () => {
    const row = new YahooConverter().convert([
      makeProduct({
        tax_rate: 10,
        yahoo_subscription_type: 1,
        yahoo_subscription_price: 3580,
        yahoo_subscription_group_index: 3,
        yahoo_subscription_recommended_cycle: "1:30",
        yahoo_subscription_point_code: 0,
      }),
    ])[0];
    expect(row["subscription-type"]).toBe("1");
    expect(row["subscription-price"]).toBe("3938");
    expect(row["subscription-group-index"]).toBe("3");
    expect(row["subscription-recommended-cycle"]).toBe("1:30");
    expect(row["subscription-point-code"]).toBe("");
  });
});
