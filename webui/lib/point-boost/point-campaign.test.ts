import { describe, expect, it } from "vitest";
import { buildBoostPatch, buildClearPatch, jstIso, parsePointCampaign } from "./point-campaign";

describe("parsePointCampaign", () => {
  it("pointCampaign から倍率と期間を取り出す", () => {
    const c = parsePointCampaign({
      manageNumber: "abc-1234",
      pointCampaign: {
        applicablePeriod: { start: "2026-08-01T00:00:00+09:00", end: "2026-08-20T00:00:00+09:00" },
        benefits: { pointRate: 2 },
      },
    });
    expect(c).not.toBeNull();
    expect(c!.rate).toBe(2);
    expect(c!.end).toBe("2026-08-20T00:00:00+09:00");
    expect(c!.startsAt?.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(c!.endsAt?.toISOString()).toBe("2026-08-19T15:00:00.000Z");
  });

  it("pointCampaign が無ければ null", () => {
    expect(parsePointCampaign({ manageNumber: "abc-1234" })).toBeNull();
    expect(parsePointCampaign(null)).toBeNull();
  });

  it("文字列の pointRate も数値化する", () => {
    const c = parsePointCampaign({ pointCampaign: { benefits: { pointRate: "3" } } });
    expect(c!.rate).toBe(3);
    expect(c!.startsAt).toBeNull();
    expect(c!.endsAt).toBeNull();
  });

  it("不正な倍率は null", () => {
    expect(parsePointCampaign({ pointCampaign: { benefits: { pointRate: "abc" } } })).toBeNull();
  });
});

describe("buildBoostPatch", () => {
  it("定期実行 6:45 → 昼帯 9:00〜17:00、17:45 → 夜帯 20:00〜23:00（次の実行時点で必ず失効済み = IE0154 対策）", () => {
    const am = buildBoostPatch(2, new Date("2026-08-16T21:45:05Z"), 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string }; benefits: { pointRate: number } };
    }; // JST 8/17 6:45:05 実行
    expect(am.pointCampaign.benefits.pointRate).toBe(2);
    expect(am.pointCampaign.applicablePeriod.start).toBe("2026-08-17T09:00:00+09:00");
    expect(am.pointCampaign.applicablePeriod.end).toBe("2026-08-17T17:00:00+09:00");

    const pm = buildBoostPatch(2, new Date("2026-08-17T08:45:05Z"), 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string } };
    }; // JST 17:45:05 実行
    expect(pm.pointCampaign.applicablePeriod.start).toBe("2026-08-17T20:00:00+09:00");
    expect(pm.pointCampaign.applicablePeriod.end).toBe("2026-08-17T23:00:00+09:00");
  });

  it("窓の途中に入るときは earliest 開始で残り区間だけ使う（手動の昼実行）", () => {
    const now = new Date("2026-08-17T03:24:30.500Z"); // JST 12:24:30 → earliest 15:00
    const patch = buildBoostPatch(2, now, 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string } };
    };
    expect(patch.pointCampaign.applicablePeriod.start).toBe("2026-08-17T15:00:00+09:00");
    expect(patch.pointCampaign.applicablePeriod.end).toBe("2026-08-17T17:00:00+09:00");
  });

  it("窓終了ちょうど・窓外は次の窓へ回す（深夜0:00〜8:59には決して置かない = 必ず1倍）", () => {
    // JST 14:59 実行 → earliest 17:00 = 昼帯終了ちょうど → 夜帯 20:00〜23:00
    const edge = buildBoostPatch(2, new Date("2026-08-17T05:59:00Z"), 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string } };
    };
    expect(edge.pointCampaign.applicablePeriod.start).toBe("2026-08-17T20:00:00+09:00");
    expect(edge.pointCampaign.applicablePeriod.end).toBe("2026-08-17T23:00:00+09:00");

    // JST 23:30 実行 → earliest 翌2:00（深夜窓外）→ 翌日の昼帯 9:00〜17:00
    const night = buildBoostPatch(2, new Date("2026-08-17T14:30:00Z"), 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string } };
    };
    expect(night.pointCampaign.applicablePeriod.start).toBe("2026-08-18T09:00:00+09:00");
    expect(night.pointCampaign.applicablePeriod.end).toBe("2026-08-18T17:00:00+09:00");

    // JST 3:00 実行 → earliest 6:00（深夜窓外）→ 当日の昼帯 9:00〜17:00
    const dawn = buildBoostPatch(2, new Date("2026-08-16T18:00:00Z"), 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string } };
    };
    expect(dawn.pointCampaign.applicablePeriod.start).toBe("2026-08-17T09:00:00+09:00");
    expect(dawn.pointCampaign.applicablePeriod.end).toBe("2026-08-17T17:00:00+09:00");
  });

  it("start は常に now の2時間超未来の正時になる（IE0121/IE0173 対策）", () => {
    for (const iso of ["2026-08-17T03:00:00.000Z", "2026-08-17T03:59:59.999Z", "2026-08-17T03:24:59.999Z"]) {
      const now = new Date(iso);
      const patch = buildBoostPatch(2, now, 7) as {
        pointCampaign: { applicablePeriod: { start: string } };
      };
      const start = new Date(patch.pointCampaign.applicablePeriod.start);
      expect(start.getTime() - now.getTime()).toBeGreaterThan(2 * 60 * 60 * 1000);
      expect(start.getUTCMinutes()).toBe(0);
      expect(start.getUTCSeconds()).toBe(0);
    }
  });
});

describe("buildClearPatch", () => {
  it("pointCampaign: null を送る", () => {
    expect(buildClearPatch()).toEqual({ pointCampaign: null });
  });
});

describe("jstIso", () => {
  it("UTC を +09:00 表記へ変換する", () => {
    expect(jstIso(new Date("2026-08-17T00:00:00Z"))).toBe("2026-08-17T09:00:00+09:00");
    expect(jstIso(new Date("2026-08-16T20:30:00Z"))).toBe("2026-08-17T05:30:00+09:00");
  });
});
