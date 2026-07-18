import { describe, it, expect } from "vitest";
import { rakutenTaxInclusive } from "./rakuten-tax";

describe("rakutenTaxInclusive (税抜 → 楽天実ページの税込表示)", () => {
  it("8% は切り捨てで換算する（実測: r7201-1 税抜3,912 → 実ページ4,224円。四捨五入なら4,225で不一致）", () => {
    expect(rakutenTaxInclusive(3912, 8)).toBe(4224); // 4224.96 → 切り捨て
  });

  it("2箱セット 税抜7,517 (8%) → 8,118円", () => {
    expect(rakutenTaxInclusive(7517, 8)).toBe(8118); // 8118.36 → 切り捨て
  });

  it("10% も切り捨て（税抜8,269 → 9,095.9 → 9,095円）", () => {
    expect(rakutenTaxInclusive(8269, 10)).toBe(9095);
  });

  it("割り切れる価格はそのまま（税抜10,000 (10%) → 11,000円）", () => {
    expect(rakutenTaxInclusive(10000, 10)).toBe(11000);
  });

  it("0円は0円のまま", () => {
    expect(rakutenTaxInclusive(0, 8)).toBe(0);
  });
});
