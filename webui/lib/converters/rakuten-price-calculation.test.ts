import { describe, expect, it } from "vitest";

import {
  calculateRakutenDiscountPrice,
  clampRakutenSubscriptionNet,
  maxRakutenNetForGross,
  rakutenGross,
  type RakutenTaxPct,
} from "./rakuten-tax";

const acceptanceCases = [
  {
    id: "T01",
    input: [4_299, 1, 8, 0] as const,
    expected: {
      unitNet: 4_299,
      quantity: 1,
      taxPct: 8,
      discountBp: 0,
      unitTax: 343,
      unitGross: 4_642,
      beforeGross: 4_642,
      targetGross: 4_642,
      afterNet: 4_299,
      afterTax: 343,
      afterGross: 4_642,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 4_642, denominator: 1 },
      actualDiscount: { numerator: 0, denominator: 4_642 },
      targetDifference: 0,
    },
  },
  {
    id: "T02",
    input: [3_565, 3, 8, 500] as const,
    expected: {
      unitNet: 3_565,
      quantity: 3,
      taxPct: 8,
      discountBp: 500,
      unitTax: 285,
      unitGross: 3_850,
      beforeGross: 11_550,
      targetGross: 10_972,
      afterNet: 10_160,
      afterTax: 812,
      afterGross: 10_972,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 10_972, denominator: 3 },
      actualDiscount: { numerator: 578, denominator: 11_550 },
      targetDifference: 0,
    },
  },
  {
    id: "T03",
    input: [3_565, 5, 8, 1_000] as const,
    expected: {
      unitNet: 3_565,
      quantity: 5,
      taxPct: 8,
      discountBp: 1_000,
      unitTax: 285,
      unitGross: 3_850,
      beforeGross: 19_250,
      targetGross: 17_325,
      afterNet: 16_042,
      afterTax: 1_283,
      afterGross: 17_325,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 17_325, denominator: 5 },
      actualDiscount: { numerator: 1_925, denominator: 19_250 },
      targetDifference: 0,
    },
  },
  {
    id: "T04",
    input: [4_299, 3, 10, 500] as const,
    expected: {
      unitNet: 4_299,
      quantity: 3,
      taxPct: 10,
      discountBp: 500,
      unitTax: 429,
      unitGross: 4_728,
      beforeGross: 14_184,
      targetGross: 13_474,
      afterNet: 12_249,
      afterTax: 1_224,
      afterGross: 13_473,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 13_473, denominator: 3 },
      actualDiscount: { numerator: 711, denominator: 14_184 },
      targetDifference: 1,
    },
  },
  {
    id: "T05",
    input: [4_299, 3, 8, 0] as const,
    expected: {
      unitNet: 4_299,
      quantity: 3,
      taxPct: 8,
      discountBp: 0,
      unitTax: 343,
      unitGross: 4_642,
      beforeGross: 13_926,
      targetGross: 13_926,
      afterNet: 12_895,
      afterTax: 1_031,
      afterGross: 13_926,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 13_926, denominator: 3 },
      actualDiscount: { numerator: 0, denominator: 13_926 },
      targetDifference: 0,
    },
  },
  {
    id: "T06",
    input: [1, 1, 8, 0] as const,
    expected: {
      unitNet: 1,
      quantity: 1,
      taxPct: 8,
      discountBp: 0,
      unitTax: 0,
      unitGross: 1,
      beforeGross: 1,
      targetGross: 1,
      afterNet: 1,
      afterTax: 0,
      afterGross: 1,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 1, denominator: 1 },
      actualDiscount: { numerator: 0, denominator: 1 },
      targetDifference: 0,
    },
  },
  {
    id: "T07",
    input: [1_000, 2, 10, 9_999] as const,
    expected: {
      unitNet: 1_000,
      quantity: 2,
      taxPct: 10,
      discountBp: 9_999,
      unitTax: 100,
      unitGross: 1_100,
      beforeGross: 2_200,
      targetGross: 0,
      afterNet: 0,
      afterTax: 0,
      afterGross: 0,
      exceedsRmsRegistrationLimit: false,
      perUnitGross: { numerator: 0, denominator: 2 },
      actualDiscount: { numerator: 2_200, denominator: 2_200 },
      targetDifference: 0,
    },
  },
] as const;

describe("calculateRakutenDiscountPrice", () => {
  it.each(acceptanceCases)("DOCX v1.0 $id と全項目が一致する", ({ input, expected }) => {
    const [unitNet, quantity, taxPct, discountBp] = input;
    expect(calculateRakutenDiscountPrice(unitNet, quantity, taxPct, discountBp)).toEqual(expected);
  });

  it.each([
    ...acceptanceCases.map(({ input }) => input),
    [999_999_999, 9_999, 8, 0] as const,
    [999_999_999, 9_999, 10, 9_999] as const,
    [999_999_999, 1, 10, 1] as const,
  ])(
    "目標以下の最大税抜という不変条件を満たす (%i, %i, %i, %i)",
    (unitNet, quantity, taxPct, discountBp) => {
      const result = calculateRakutenDiscountPrice(unitNet, quantity, taxPct, discountBp);

      expect(result.afterGross).toBeLessThanOrEqual(result.targetGross);
      expect(rakutenGross(result.afterNet + 1, taxPct)).toBeGreaterThan(result.targetGross);
      expect(rakutenGross(result.afterNet, taxPct)).toBe(result.afterGross);
      expect(Number.isSafeInteger(result.beforeGross)).toBe(true);
      expect(Number.isSafeInteger(result.targetGross)).toBe(true);
    },
  );

  it("入力範囲を明示的に検証する", () => {
    expect(() => calculateRakutenDiscountPrice(0, 1, 8, 0)).toThrow(
      "unitNet must be between 1 and 999999999",
    );
    expect(() => calculateRakutenDiscountPrice(1.5, 1, 8, 0)).toThrow(
      "unitNet must be a safe integer",
    );
    expect(() => calculateRakutenDiscountPrice(1, 0, 8, 0)).toThrow(
      "quantity must be between 1 and 9999",
    );
    expect(() => calculateRakutenDiscountPrice(1, 10_000, 8, 0)).toThrow(
      "quantity must be between 1 and 9999",
    );
    expect(() => calculateRakutenDiscountPrice(1, 1, 9 as RakutenTaxPct, 0)).toThrow(
      "taxPct must be 8 or 10",
    );
    expect(() => calculateRakutenDiscountPrice(1, 1, 8, -1)).toThrow(
      "discountBp must be between 0 and 9999",
    );
    expect(() => calculateRakutenDiscountPrice(1, 1, 8, 10_000)).toThrow(
      "discountBp must be between 0 and 9999",
    );
    expect(() => calculateRakutenDiscountPrice(1, 1, 8, 0.5)).toThrow(
      "discountBp must be a safe integer",
    );
  });

  it("RMS登録価格が9桁を超える場合は警告・コピー抑止用フラグを返す", () => {
    const result = calculateRakutenDiscountPrice(999_999_999, 9_999, 10, 0);

    expect(result.afterNet).toBeGreaterThan(999_999_999);
    expect(result.exceedsRmsRegistrationLimit).toBe(true);
  });
});

describe("maxRakutenNetForGross", () => {
  it.each([
    [0, 8],
    [1, 8],
    [13_474, 10],
    [13_926, 8],
    [10_998_899_980_002, 10],
  ] as const)("境界目標 %i円・税率%i%%で最大値を返す", (targetGross, taxPct) => {
    const net = maxRakutenNetForGross(targetGross, taxPct);

    expect(rakutenGross(net, taxPct)).toBeLessThanOrEqual(targetGross);
    expect(rakutenGross(net + 1, taxPct)).toBeGreaterThan(targetGross);
  });

  it("負数・小数を拒否する", () => {
    expect(() => maxRakutenNetForGross(-1, 8)).toThrow(
      "targetGross must be between 0 and 10998899980002",
    );
    expect(() => maxRakutenNetForGross(1.5, 8)).toThrow(
      "targetGross must be a safe integer",
    );
  });
});

describe("clampRakutenSubscriptionNet", () => {
  it("逆算値と通常税抜の5%引き上限が衝突する場合は上限側へ倒す", () => {
    expect(clampRakutenSubscriptionNet(1_236, 1_301)).toBe(1_235);
  });

  it("逆算値が上限以下なら変更しない", () => {
    expect(clampRakutenSubscriptionNet(1_200, 1_301)).toBe(1_200);
  });

  it("金額は非負の安全な整数だけを受け付ける", () => {
    expect(() => clampRakutenSubscriptionNet(-1, 1_301)).toThrow(
      "inverseNet must be between 0 and 10998899980002",
    );
    expect(() => clampRakutenSubscriptionNet(1_200, 1_301.5)).toThrow(
      "regularNet must be a safe integer",
    );
  });
});
