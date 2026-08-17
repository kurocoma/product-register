import { describe, expect, it } from "vitest";
import { decideTargetRate, isActiveCampaign, needsUpdate, REFRESH_REMAINING_MS } from "./rate-rule";

const settings = { plus_rate: 1, max_rate: 3 };

describe("decideTargetRate", () => {
  it("他店1倍 → 自店2倍（依頼の基本例）", () => {
    expect(decideTargetRate(1, settings)).toEqual({ targetRate: 2, capped: false });
  });

  it("他店2倍 → 自店3倍", () => {
    expect(decideTargetRate(2, settings)).toEqual({ targetRate: 3, capped: false });
  });

  it("他店3倍 → 上限3倍で打ち止め（capped）", () => {
    expect(decideTargetRate(3, settings)).toEqual({ targetRate: 3, capped: true });
  });

  it("他店10倍 → 上限3倍で打ち止め（capped）", () => {
    expect(decideTargetRate(10, settings)).toEqual({ targetRate: 3, capped: true });
  });

  it("競合情報なし（0）は1倍とみなして2倍", () => {
    expect(decideTargetRate(0, settings)).toEqual({ targetRate: 2, capped: false });
  });

  it("上限1倍の設定では変倍しない（RMSの下限2倍未満）", () => {
    expect(decideTargetRate(1, { plus_rate: 1, max_rate: 1 })).toEqual({ targetRate: 1, capped: true });
  });

  it("上限はRMSの最大20倍にクランプされる", () => {
    expect(decideTargetRate(30, { plus_rate: 1, max_rate: 99 })).toEqual({ targetRate: 20, capped: true });
  });

  it("小数の競合倍率は切り捨てて扱う", () => {
    expect(decideTargetRate(2.5, settings)).toEqual({ targetRate: 3, capped: false });
  });
});

describe("needsUpdate", () => {
  const now = new Date("2026-08-17T00:00:00Z");
  const farEnd = new Date(now.getTime() + REFRESH_REMAINING_MS + 60_000);
  const nearEnd = new Date(now.getTime() + REFRESH_REMAINING_MS - 60_000);

  it("未設定なら更新が必要", () => {
    expect(needsUpdate(null, 2, now)).toBe(true);
  });

  it("倍率が違えば更新が必要", () => {
    expect(needsUpdate({ rate: 2, endsAt: farEnd }, 3, now)).toBe(true);
  });

  it("同じ倍率で期間が十分なら更新不要", () => {
    expect(needsUpdate({ rate: 2, endsAt: farEnd }, 2, now)).toBe(false);
  });

  it("同じ倍率でも終了が近ければ延長する", () => {
    expect(needsUpdate({ rate: 2, endsAt: nearEnd }, 2, now)).toBe(true);
  });

  it("期間不明なら設定し直す", () => {
    expect(needsUpdate({ rate: 2, endsAt: null }, 2, now)).toBe(true);
  });

  it("目標1倍（変倍しない）は更新対象外", () => {
    expect(needsUpdate({ rate: 2, endsAt: farEnd }, 1, now)).toBe(false);
  });
});

describe("isActiveCampaign", () => {
  const now = new Date("2026-08-17T00:00:00Z");

  it("2倍以上かつ期限内なら有効", () => {
    expect(isActiveCampaign({ rate: 2, endsAt: new Date(now.getTime() + 1000) }, now)).toBe(true);
  });

  it("期限切れは無効", () => {
    expect(isActiveCampaign({ rate: 2, endsAt: new Date(now.getTime() - 1000) }, now)).toBe(false);
  });

  it("未設定は無効", () => {
    expect(isActiveCampaign(null, now)).toBe(false);
  });

  it("期間不明でも倍率が入っていれば有効扱い（解除を試みる安全側）", () => {
    expect(isActiveCampaign({ rate: 3, endsAt: null }, now)).toBe(true);
  });
});
