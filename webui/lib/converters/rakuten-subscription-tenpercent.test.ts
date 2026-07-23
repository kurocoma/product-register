import { describe, it, expect } from "vitest";
import {
  rakutenSubscriptionNetFromRegular,
  clampRakutenSubscriptionNet,
} from "./rakuten-tax";

/**
 * しまのや案件（2026-07-21 ユーザー指定）の定期購入価格ルール:
 * 定期購入税抜価格 = floor(そのSKUの通常税抜価格 × 0.90)（各個数の通常価格から10%引き・切り捨て）。
 *
 * discountBp = 1000 が 10%。整数演算のみで、浮動小数を使わない。
 * 10%引きは 5%引き上限（IE0430）以下なので楽天の定期価格制約と両立する。
 */
describe("rakutenSubscriptionNetFromRegular — 通常税抜からの割引切り捨て", () => {
  it("10%引き(discountBp=1000)は floor(regularNet × 0.90)", () => {
    expect(rakutenSubscriptionNetFromRegular(2079, 1000)).toBe(1871); // floor(1871.1)
    expect(rakutenSubscriptionNetFromRegular(2100, 1000)).toBe(1890); // 2100×0.9=1890 ちょうど
    expect(rakutenSubscriptionNetFromRegular(10, 1000)).toBe(9); // 境界: 9.0 を下側で確定
    expect(rakutenSubscriptionNetFromRegular(1, 1000)).toBe(0); // floor(0.9)=0
    expect(rakutenSubscriptionNetFromRegular(0, 1000)).toBe(0);
  });

  it("割引前(discountBp=0)は据え置き、5%引き(500)は floor(× 0.95)", () => {
    expect(rakutenSubscriptionNetFromRegular(12345, 0)).toBe(12345);
    expect(rakutenSubscriptionNetFromRegular(10000, 500)).toBe(9500);
  });

  it("大きな税抜でも整数のまま桁あふれしない", () => {
    expect(rakutenSubscriptionNetFromRegular(999_999_999, 1000)).toBe(899_999_999);
  });

  it("10%引きは常に5%引き上限(IE0430 clamp)以下 = 楽天定期制約を満たす", () => {
    for (const net of [1, 99, 100, 2079, 3565, 4299, 123_456, 999_999]) {
      const tenOff = rakutenSubscriptionNetFromRegular(net, 1000);
      const fivePercentLimit = clampRakutenSubscriptionNet(net, net); // = floor(net×0.95)
      expect(tenOff).toBeLessThanOrEqual(fivePercentLimit);
    }
  });

  it("入力バリデーション: 非整数・範囲外は throw", () => {
    expect(() => rakutenSubscriptionNetFromRegular(1.5, 1000)).toThrow();
    expect(() => rakutenSubscriptionNetFromRegular(-1, 1000)).toThrow();
    expect(() => rakutenSubscriptionNetFromRegular(1000, -1)).toThrow();
    expect(() => rakutenSubscriptionNetFromRegular(1000, 10_001)).toThrow();
  });
});
