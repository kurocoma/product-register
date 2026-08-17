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
  it("now〜now+days のJST期間で pointCampaign パッチを組む", () => {
    const now = new Date("2026-08-17T03:24:30.500Z"); // JST 12:24:30
    const patch = buildBoostPatch(2, now, 7) as {
      pointCampaign: { applicablePeriod: { start: string; end: string }; benefits: { pointRate: number } };
    };
    expect(patch.pointCampaign.benefits.pointRate).toBe(2);
    // 秒以下は切り捨て、JST(+09:00)表記
    expect(patch.pointCampaign.applicablePeriod.start).toBe("2026-08-17T12:24:00+09:00");
    expect(patch.pointCampaign.applicablePeriod.end).toBe("2026-08-24T12:24:00+09:00");
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
