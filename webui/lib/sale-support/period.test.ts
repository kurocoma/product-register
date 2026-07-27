import { describe, it, expect } from "vitest";
import { discountPercentToBp, toRakutenDateTime, validateSalePeriod } from "./period";

describe("toRakutenDateTime: purchasablePeriod の書式（2026-07-28 実機検証で確定）", () => {
  it("datetime-local（分まで）→ ISO8601+09:00（実機で patch→getItem が同一書式で往復）", () => {
    expect(toRakutenDateTime("2026-09-04T20:00")).toBe("2026-09-04T20:00:00+09:00");
  });

  it("秒付き入力も受理する", () => {
    expect(toRakutenDateTime("2026-08-01T10:00:30")).toBe("2026-08-01T10:00:30+09:00");
  });

  it("確定書式はそのまま通す", () => {
    expect(toRakutenDateTime("2026-08-01T10:00:00+09:00")).toBe("2026-08-01T10:00:00+09:00");
  });

  it("不正・実在しない日時は null", () => {
    expect(toRakutenDateTime("")).toBeNull();
    expect(toRakutenDateTime("abc")).toBeNull();
    expect(toRakutenDateTime("2026-13-40T99:99")).toBeNull();
    expect(toRakutenDateTime("2026-08-01 10:00")).toBeNull();
  });
});

describe("validateSalePeriod", () => {
  it("開始 < 終了で確定書式の期間を返す", () => {
    const r = validateSalePeriod("2026-09-04T20:00", "2026-09-11T01:59");
    expect(r).toEqual({
      ok: true,
      period: { start: "2026-09-04T20:00:00+09:00", end: "2026-09-11T01:59:00+09:00" },
    });
  });

  it("開始 >= 終了はエラー", () => {
    const r = validateSalePeriod("2026-09-11T01:59", "2026-09-04T20:00");
    expect(r.ok).toBe(false);
    const same = validateSalePeriod("2026-09-04T20:00", "2026-09-04T20:00");
    expect(same.ok).toBe(false);
  });

  it("不正な入力は項目名入りのエラー", () => {
    const r = validateSalePeriod("bad", "2026-09-11T01:59");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("開始");
  });
});

describe("discountPercentToBp: 値引き％ → bp（0.01%単位）", () => {
  it("整数・小数第2位までを bp 化する", () => {
    expect(discountPercentToBp(20)).toBe(2000);
    expect(discountPercentToBp(5.5)).toBe(550);
    expect(discountPercentToBp(0.01)).toBe(1);
    expect(discountPercentToBp(99.99)).toBe(9999);
  });

  it("0%・100%以上・負値・小数第3位以下・非数は拒否", () => {
    expect(discountPercentToBp(0)).toBeNull();
    expect(discountPercentToBp(100)).toBeNull();
    expect(discountPercentToBp(-5)).toBeNull();
    expect(discountPercentToBp(20.005)).toBeNull();
    expect(discountPercentToBp(Number.NaN)).toBeNull();
    expect(discountPercentToBp(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
