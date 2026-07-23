/** 楽天 実ページ表示の税込換算（selling_price は全モール税抜統一）。
 *
 * 当店（ichiban-okinawa）の楽天商品は税別で登録されており（items.get の standardPrice = 税抜値）、
 * 実ページの税込表示は RMS の店舗税設定どおり「切り捨て」で計算される
 * （実測: r7201-1 税抜3,912 × 1.08 = 4,224.96 → 実ページ 4,224円）。
 * Yahoo（四捨五入 yahooTaxInclusive）・Shopify（Math.round priceWithTax）とは丸めが異なるので共用しない。 */
export function rakutenTaxInclusive(priceExclusive: number, taxRate: number): number {
  return priceExclusive + Math.floor((priceExclusive * taxRate) / 100);
}

export type RakutenTaxPct = 8 | 10;

/**
 * 浮動小数を使わずに保持する未約分の整数比。
 *
 * `numerator / denominator` が値を表す。表示時の丸めは呼び出し側で行い、
 * この価格計算の入力へ戻してはならない。
 */
export interface RakutenIntegerRatio {
  readonly numerator: number;
  readonly denominator: number;
}

export interface RakutenDiscountPriceResult {
  readonly unitNet: number;
  readonly quantity: number;
  readonly taxPct: RakutenTaxPct;
  readonly discountBp: number;
  readonly unitTax: number;
  readonly unitGross: number;
  readonly beforeGross: number;
  readonly targetGross: number;
  readonly afterNet: number;
  readonly afterTax: number;
  readonly afterGross: number;
  /** RMS登録価格の9桁上限を超え、UIで警告・コピー抑止が必要か。 */
  readonly exceedsRmsRegistrationLimit: boolean;
  /** 1個当たり税込額。`afterGross / quantity` の未約分整数比。 */
  readonly perUnitGross: RakutenIntegerRatio;
  /** 実効割引率。`(beforeGross - afterGross) / beforeGross` の未約分整数比。 */
  readonly actualDiscount: RakutenIntegerRatio;
  readonly targetDifference: number;
}

const MAX_UNIT_NET = 999_999_999;
export const RAKUTEN_RMS_MAX_REGISTRATION_PRICE = MAX_UNIT_NET;
const MAX_QUANTITY = 9_999;
// 最大単品税込（10%）×最大数量。DOCX v1.0 の入力範囲で到達し得る最大額。
const MAX_SUPPORTED_GROSS = 10_998_899_980_002;

function assertSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
}

function assertIntegerRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  assertSafeInteger(name, value);
  if (value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function assertRakutenTaxPct(taxPct: number): asserts taxPct is RakutenTaxPct {
  assertSafeInteger("taxPct", taxPct);
  if (taxPct !== 8 && taxPct !== 10) {
    throw new RangeError("taxPct must be 8 or 10");
  }
}

/** `floor(value * multiplier / divisor)` を中間積の桁あふれなしで求める。 */
function floorMultiplyDivide(value: number, multiplier: number, divisor: number): number {
  const quotient = Math.floor(value / divisor);
  const remainder = value % divisor;
  return quotient * multiplier + Math.floor((remainder * multiplier) / divisor);
}

/** `ceil(value * multiplier / divisor)` を中間積の桁あふれなしで求める。 */
function ceilMultiplyDivide(value: number, multiplier: number, divisor: number): number {
  const quotient = Math.floor(value / divisor);
  const remainder = value % divisor;
  return quotient * multiplier + Math.ceil((remainder * multiplier) / divisor);
}

/** 楽天RMS方式の税込額: 税抜 + floor(税抜 × 税率 / 100)。 */
export function rakutenGross(net: number, taxPct: RakutenTaxPct): number {
  assertIntegerRange("net", net, 0, MAX_SUPPORTED_GROSS);
  assertRakutenTaxPct(taxPct);

  const tax = floorMultiplyDivide(net, taxPct, 100);
  const gross = net + tax;
  if (!Number.isSafeInteger(gross)) {
    throw new RangeError("gross exceeds the safe integer range");
  }
  return gross;
}

/**
 * RMS再計算額が `targetGross` を超えない最大の整数税抜額を返す。
 *
 * DOCX v1.0 §4.3どおり、ceil候補をRMS方式で再計算して上下に補正する。
 */
export function maxRakutenNetForGross(
  targetGross: number,
  taxPct: RakutenTaxPct,
): number {
  assertIntegerRange("targetGross", targetGross, 0, MAX_SUPPORTED_GROSS);
  assertRakutenTaxPct(taxPct);

  let candidate = ceilMultiplyDivide(targetGross, 100, 100 + taxPct);

  while (candidate > 0 && rakutenGross(candidate, taxPct) > targetGross) {
    candidate -= 1;
  }
  while (rakutenGross(candidate + 1, taxPct) <= targetGross) {
    candidate += 1;
  }

  return candidate;
}

/**
 * 楽天RMS向けのセットSKU割引価格を、円・税率・割引率すべて整数で計算する。
 *
 * `perUnitGross` と `actualDiscount` も浮動小数へ変換せず、未約分の整数比で返す。
 */
export function calculateRakutenDiscountPrice(
  unitNet: number,
  quantity: number,
  taxPct: RakutenTaxPct,
  discountBp: number,
): RakutenDiscountPriceResult {
  assertIntegerRange("unitNet", unitNet, 1, MAX_UNIT_NET);
  assertIntegerRange("quantity", quantity, 1, MAX_QUANTITY);
  assertRakutenTaxPct(taxPct);
  assertIntegerRange("discountBp", discountBp, 0, 9_999);

  const unitTax = floorMultiplyDivide(unitNet, taxPct, 100);
  const unitGross = unitNet + unitTax;
  const beforeGross = unitGross * quantity;
  if (!Number.isSafeInteger(beforeGross)) {
    throw new RangeError("beforeGross exceeds the safe integer range");
  }

  const targetGross = floorMultiplyDivide(beforeGross, 10_000 - discountBp, 10_000);
  const afterNet = maxRakutenNetForGross(targetGross, taxPct);
  const afterTax = floorMultiplyDivide(afterNet, taxPct, 100);
  const afterGross = afterNet + afterTax;

  return {
    unitNet,
    quantity,
    taxPct,
    discountBp,
    unitTax,
    unitGross,
    beforeGross,
    targetGross,
    afterNet,
    afterTax,
    afterGross,
    exceedsRmsRegistrationLimit: afterNet > RAKUTEN_RMS_MAX_REGISTRATION_PRICE,
    perUnitGross: { numerator: afterGross, denominator: quantity },
    actualDiscount: {
      numerator: beforeGross - afterGross,
      denominator: beforeGross,
    },
    targetDifference: targetGross - afterGross,
  };
}

/**
 * 楽天の定期購入価格（通常税抜から5%以上引き）の上限を適用する。
 * 一般の税込逆算とは別規則なので、価格計算本体には混ぜない。
 */
export function clampRakutenSubscriptionNet(inverseNet: number, regularNet: number): number {
  assertIntegerRange("inverseNet", inverseNet, 0, MAX_SUPPORTED_GROSS);
  assertIntegerRange("regularNet", regularNet, 0, MAX_SUPPORTED_GROSS);

  const fivePercentOffLimit = floorMultiplyDivide(regularNet, 9_500, 10_000);
  return Math.min(inverseNet, fivePercentOffLimit);
}

/**
 * 通常税抜価格から割引率(bp)ぶん引いた定期購入税抜価格を、整数だけで切り捨て計算する。
 *
 * `floor(regularNet × (10000 − discountBp) / 10000)`。浮動小数を使わない。
 * しまのや案件（2026-07-21 ユーザー指定）は各SKUの通常税抜価格から10%引き
 * （discountBp = 1000）で `floor(regularNet × 0.90)`。
 *
 * 5%以上の割引（discountBp ≥ 500）であれば楽天RMSの IE0430（定期は通常から5%以上割引）を
 * 常に満たす（`floor(n×0.90) ≤ floor(n×0.95)`）ため、`validateSubscription` と両立する。
 */
export function rakutenSubscriptionNetFromRegular(regularNet: number, discountBp: number): number {
  assertIntegerRange("regularNet", regularNet, 0, MAX_SUPPORTED_GROSS);
  assertIntegerRange("discountBp", discountBp, 0, 10_000);
  return floorMultiplyDivide(regularNet, 10_000 - discountBp, 10_000);
}
