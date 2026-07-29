import { describe, it, expect } from "vitest";
import {
  planPages,
  parsePagenationCount,
  mergeCsvPages,
  verifyMergedRowCount,
  parseScriptEvent,
  isNeAutoDownloadTargetKey,
  neAutoDownloadLabel,
  NE_AUTO_DOWNLOAD_TARGETS,
} from "./auto-download";
import { parseNeSet } from "./parse";

describe("planPages（1000件境界）", () => {
  it("0件は0ページ", () => {
    expect(planPages(0, 1000)).toBe(0);
    expect(planPages(-5, 1000)).toBe(0);
    expect(planPages(NaN, 1000)).toBe(0);
  });
  it("1〜1000件は1ページ", () => {
    expect(planPages(1, 1000)).toBe(1);
    expect(planPages(775, 1000)).toBe(1);
    expect(planPages(1000, 1000)).toBe(1);
  });
  it("1001件から2ページ", () => {
    expect(planPages(1001, 1000)).toBe(2);
    expect(planPages(2000, 1000)).toBe(2);
    expect(planPages(2001, 1000)).toBe(3);
  });
  it("pageSize が不正なら既定1000で計算", () => {
    expect(planPages(1500, 0)).toBe(2);
    expect(planPages(1500, NaN)).toBe(2);
  });
});

describe("parsePagenationCount", () => {
  it("NEの件数表記を読む", () => {
    expect(parsePagenationCount("全775件中1-775を表示")).toEqual({ total: 775, from: 1, to: 775 });
  });
  it("カンマ区切り・空白入りでも読む", () => {
    expect(parsePagenationCount(" 全1,250件中 1,001-1,250 を表示 ")).toEqual({ total: 1250, from: 1001, to: 1250 });
  });
  it("読めない文字列は null", () => {
    expect(parsePagenationCount("結果はありません")).toBeNull();
    expect(parsePagenationCount("")).toBeNull();
  });
});

describe("mergeCsvPages", () => {
  it("2ページを結合し、2ページ目のヘッダーは捨てる", () => {
    const p1 = "code,name\r\na1,あ\r\na2,い\r\n";
    const p2 = "code,name\r\nb1,う\r\n";
    const m = mergeCsvPages([p1, p2]);
    expect(m.rows).toBe(3);
    expect(m.pages).toBe(2);
    expect(m.header).toEqual(["code", "name"]);
    // ヘッダーは1本だけ
    expect(m.csv.split(/\r?\n/).filter((l) => l.startsWith("code,name")).length).toBe(1);
    expect(m.csv).toContain("b1,う");
  });

  it("0件（ヘッダーのみ）は rows 0 で返す", () => {
    const m = mergeCsvPages(["code,name\r\n"]);
    expect(m.rows).toBe(0);
    expect(m.header).toEqual(["code", "name"]);
  });

  it("空文字ページは無視する", () => {
    const m = mergeCsvPages(["code,name\r\na1,あ\r\n", "", "   "]);
    expect(m.rows).toBe(1);
    expect(m.pages).toBe(1);
  });

  it("全ページ空ならエラー", () => {
    expect(() => mergeCsvPages(["", "  "])).toThrow(/結合できるCSV/);
  });

  it("列構成が違うページはエラー", () => {
    expect(() => mergeCsvPages(["code,name\r\na1,あ\r\n", "code,name,price\r\nb1,う,100\r\n"])).toThrow(
      /列構成が一致しません/,
    );
    expect(() => mergeCsvPages(["code,name\r\na1,あ\r\n", "code,title\r\nb1,う\r\n"])).toThrow(/列構成が一致しません/);
  });

  it("1000件境界: 1000行+250行 を 1250行に結合する", () => {
    const page = (from: number, n: number) =>
      "code,name\r\n" + Array.from({ length: n }, (_, i) => `c${from + i},n${from + i}`).join("\r\n") + "\r\n";
    const m = mergeCsvPages([page(1, 1000), page(1001, 250)]);
    expect(m.rows).toBe(1250);
    expect(m.csv).toContain("c1000,n1000");
    expect(m.csv).toContain("c1250,n1250");
  });

  it("引用符内の改行・カンマを壊さない（NEセットCSVの説明文対策）", () => {
    const p1 = 'code,desc\r\n"a1","1行目\n2行目, カンマ"\r\n';
    const p2 = 'code,desc\r\n"b1","ふつう"\r\n';
    const m = mergeCsvPages([p1, p2]);
    expect(m.rows).toBe(2);
    const back = mergeCsvPages([m.csv]);
    expect(back.rows).toBe(2);
    expect(m.csv).toContain("1行目\n2行目, カンマ");
  });

  it("結合結果が既存の parseNeSet でそのまま読める", () => {
    const header = Array.from({ length: 8 }, (_, i) => `col${i}`).join(",");
    const row = (set: string) => `${set},d1,"セット\n名",1000,10,cmp1,2,4901234567894`;
    const m = mergeCsvPages([`${header}\r\n${row("s1")}\r\n`, `${header}\r\n${row("s2")}\r\n`]);
    const parsed = parseNeSet(m.csv);
    expect(parsed.map((r) => r.set_ne_code)).toEqual(["s1", "s2"]);
    expect(parsed[0].suryo).toBe(2);
    expect(parsed[0].jan_code).toBe("4901234567894");
  });

  it("BOM付きページでもヘッダー一致とみなす", () => {
    const m = mergeCsvPages(["﻿code,name\r\na1,あ\r\n", "code,name\r\nb1,い\r\n"]);
    expect(m.rows).toBe(2);
  });
});

describe("verifyMergedRowCount", () => {
  it("一致なら警告なし", () => {
    expect(verifyMergedRowCount(775, 775)).toBeNull();
  });
  it("期待値不明なら警告なし", () => {
    expect(verifyMergedRowCount(775, null)).toBeNull();
  });
  it("不一致なら警告文", () => {
    expect(verifyMergedRowCount(700, 775)).toMatch(/775 件/);
  });
});

describe("parseScriptEvent", () => {
  it("既知のイベントを解釈する", () => {
    expect(parseScriptEvent('{"type":"progress","message":"ログイン中"}')).toEqual({
      type: "progress",
      message: "ログイン中",
    });
    const done = parseScriptEvent('{"type":"target-done","key":"ne-syohin","pageFiles":["a.csv"],"entries":775,"pageItems":1000}');
    expect(done).toMatchObject({ type: "target-done", key: "ne-syohin", entries: 775 });
  });
  it("JSON でない行・未知typeは null", () => {
    expect(parseScriptEvent("普通のログ")).toBeNull();
    expect(parseScriptEvent("{壊れた")).toBeNull();
    expect(parseScriptEvent('{"type":"unknown"}')).toBeNull();
    expect(parseScriptEvent("")).toBeNull();
  });
});

describe("対象定義", () => {
  it("キーは既存の取込ソースキーと一致する", () => {
    expect(NE_AUTO_DOWNLOAD_TARGETS.map((t) => t.key)).toEqual(["ne-syohin", "ne-set", "ne-himoduke"]);
    expect(isNeAutoDownloadTargetKey("ne-set")).toBe(true);
    expect(isNeAutoDownloadTargetKey("excel-master")).toBe(false);
    expect(isNeAutoDownloadTargetKey(null)).toBe(false);
    expect(neAutoDownloadLabel("ne-set")).toBe("NE セット商品マスタ");
  });
});
