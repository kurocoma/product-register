import { describe, it, expect } from "vitest";
import { periodRange, buildHistoryFilter } from "./filter";

describe("periodRange（作業履歴の期間 → created_at の範囲）", () => {
  it("today は当日 0:00 から（終了は指定なし）", () => {
    const now = new Date(2026, 6, 11, 15, 30, 45); // 2026-07-11(土) 15:30:45 ローカル
    const r = periodRange("today", now);
    expect(r.fromIso).toBe(new Date(2026, 6, 11, 0, 0, 0, 0).toISOString());
    expect(r.toIso).toBeUndefined();
  });

  it("week は月曜始まり: 日曜に呼んでも直前の月曜 0:00 になる", () => {
    const sunday = new Date(2026, 6, 12, 10, 0); // 2026-07-12 は日曜
    const r = periodRange("week", sunday);
    expect(r.fromIso).toBe(new Date(2026, 6, 6).toISOString()); // 2026-07-06(月) 0:00
  });

  it("week: 月曜に呼ぶと当日 0:00 が開始になる", () => {
    const monday = new Date(2026, 6, 6, 9, 0); // 2026-07-06 は月曜
    expect(periodRange("week", monday).fromIso).toBe(new Date(2026, 6, 6).toISOString());
  });

  it("custom は from の 0:00 〜 to の翌日 0:00（to 当日を含む）", () => {
    const r = periodRange("custom", new Date(), "2026-07-01", "2026-07-10");
    expect(r.fromIso).toBe(new Date(2026, 6, 1).toISOString());
    expect(r.toIso).toBe(new Date(2026, 6, 11).toISOString()); // 7/10 の翌日 0:00 未満 → 7/10 全体を含む
  });

  it("custom の to が月末なら翌日 0:00 は翌月 1 日になる（月またぎ）", () => {
    const r = periodRange("custom", new Date(), "2026-01-31", "2026-01-31");
    expect(r.fromIso).toBe(new Date(2026, 0, 31).toISOString());
    expect(r.toIso).toBe(new Date(2026, 1, 1).toISOString());
  });

  it("custom は from / to の片方だけでも成立する", () => {
    const onlyFrom = periodRange("custom", new Date(), "2026-07-01", undefined);
    expect(onlyFrom.fromIso).toBe(new Date(2026, 6, 1).toISOString());
    expect(onlyFrom.toIso).toBeUndefined();

    const onlyTo = periodRange("custom", new Date(), undefined, "2026-07-10");
    expect(onlyTo.fromIso).toBeUndefined();
    expect(onlyTo.toIso).toBe(new Date(2026, 6, 11).toISOString());
  });

  it("空文字（全期間）と custom の不正な日付文字列は範囲なし", () => {
    expect(periodRange("", new Date())).toEqual({});
    expect(periodRange("custom", new Date(), "2026/07/01", "not-a-date")).toEqual({});
  });
});

describe("buildHistoryFilter（Supabase クエリ条件の組み立て）", () => {
  it("action は完全一致条件、code は前後空白を除いた部分一致パターンになる", () => {
    const f = buildHistoryFilter({ action: "edit", code: " a009 ", period: "" });
    expect(f.action).toBe("edit");
    expect(f.codeLike).toBe("%a009%");
    expect(f.fromIso).toBeUndefined();
    expect(f.toIso).toBeUndefined();
  });

  it("全て（action 空）・空欄（code 空）・全期間のときは条件を一切付けない", () => {
    const f = buildHistoryFilter({ action: "", code: "", period: "" });
    expect(f).toEqual({});
  });

  it("period=today は now 基準で fromIso に展開される", () => {
    const now = new Date(2026, 6, 11, 23, 59);
    const f = buildHistoryFilter({ action: "csv_export", code: "", period: "today", now });
    expect(f.action).toBe("csv_export");
    expect(f.fromIso).toBe(new Date(2026, 6, 11).toISOString());
    expect(f.toIso).toBeUndefined();
  });

  it("period=custom は from/to が fromIso/toIso（to は当日を含む）に展開される", () => {
    const f = buildHistoryFilter({
      action: "",
      code: "",
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-10",
    });
    expect(f.fromIso).toBe(new Date(2026, 6, 1).toISOString());
    expect(f.toIso).toBe(new Date(2026, 6, 11).toISOString());
  });
});
