// 総件数の解決（data-entries →「全N件中…」表記 → 不明）と、
// 「件数不明＝要確認」に倒す安全弁、そして対象定義の一本化（lib 正本 ⇔ CLI フォールバック）のテスト。
//
// 背景: data-entries が読めないと needPages が 1 に潰れ、1000件超の後半ページを取りこぼしたまま
// 警告も出ずに既存マスタへ流し込まれる事故になりうる（紐づけ表のようにコンテナ id 未確定の対象で起きやすい）。
import { describe, it, expect } from "vitest";
import {
  resolveTotalEntries,
  evaluateMergedPages,
  planPages,
  neAutoDownloadTargetDefs,
  neProbeSearchTargets,
  NE_AUTO_DOWNLOAD_TARGETS,
  NE_SEARCH_TARGET_OPTIONS,
  NE_PAGE_ITEMS_DEFAULT,
} from "./auto-download";
// CLI 単体起動時のフォールバック（playwright を読み込まない純ロジック側）。
import * as scriptDefaults from "../../scripts/ne-master-defaults.mjs";

type TargetDef = {
  key: string;
  label: string;
  searchTargetTexts: string[];
  searchTargetValue: string;
  containerIds: string[];
  fileNames: string[];
  panelPattern: string;
  panelPatternFlags: string;
};
type Resolution = { total: number | null; source: string; mayHaveMore: boolean };

const script = scriptDefaults as unknown as {
  NE_PAGE_ITEMS_DEFAULT: number;
  DEFAULT_TARGET_DEFS: TargetDef[];
  probeSearchTargetsFromDefs: (defs: TargetDef[]) => { value: string; text: string; containerIds: string[] }[];
  resolveTotalEntries: (info: Record<string, unknown>) => Resolution;
  describePaginationLinks: (links: unknown[]) => string;
};

describe("resolveTotalEntries（総件数の3段解決）", () => {
  it("1段目: data-entries があればそれを使う", () => {
    expect(resolveTotalEntries({ entries: 775, countText: "全775件中1-775を表示", rowCount: 775, pageItems: 1000 })).toEqual({
      total: 775,
      source: "data-entries",
      mayHaveMore: false,
    });
  });

  it("2段目: data-entries が取れなくても件数表記から解決する", () => {
    expect(resolveTotalEntries({ entries: null, countText: "全1,250件中1-1,000を表示", rowCount: 1000, pageItems: 1000 })).toEqual(
      { total: 1250, source: "count-text", mayHaveMore: false },
    );
    // 解決できれば従来どおり必要ページ数を計算できる（1000件超は2ページ）
    expect(planPages(resolveTotalEntries({ countText: "全1250件中1-1000を表示" }).total!, 1000)).toBe(2);
  });

  it("3段目: どちらも読めなければ unknown（1ページ＝全件と決めつけない）", () => {
    const r = resolveTotalEntries({ entries: null, countText: "", rowCount: 1000, pageItems: 1000 });
    expect(r.total).toBeNull();
    expect(r.source).toBe("unknown");
    expect(r.mayHaveMore).toBe(true); // 1ページ目が満杯＝続きがある可能性 → 次ページ探索へ
  });

  it("件数不明でも1ページ目が満杯でなければ続きは無いと判断する", () => {
    expect(resolveTotalEntries({ entries: null, countText: "読めない文字列", rowCount: 42, pageItems: 1000 })).toEqual({
      total: null,
      source: "unknown",
      mayHaveMore: false,
    });
  });

  it("pageItems が不正なら既定1000で満杯判定する", () => {
    expect(resolveTotalEntries({ rowCount: NE_PAGE_ITEMS_DEFAULT, pageItems: 0 }).mayHaveMore).toBe(true);
    expect(resolveTotalEntries({ rowCount: NE_PAGE_ITEMS_DEFAULT - 1, pageItems: undefined }).mayHaveMore).toBe(false);
  });

  it("0件は unknown ではなく 0 として扱う（空CSV検出は呼び出し側の役目）", () => {
    expect(resolveTotalEntries({ entries: 0, countText: "", rowCount: 0 })).toMatchObject({ total: 0, source: "data-entries" });
  });

  it("行数も読めない完全な不明でも例外にならない", () => {
    expect(resolveTotalEntries({})).toEqual({ total: null, source: "unknown", mayHaveMore: false });
  });
});

describe("evaluateMergedPages（件数不明は「安全」ではなく「要確認」）", () => {
  it("総件数不明なら警告を出して自動取込をブロックする", () => {
    const v = evaluateMergedPages({ rows: 1000, entries: null, mergedPages: 1, expectedPages: 0, entriesUnknown: true });
    expect(v.autoImportBlocked).toBe(true);
    expect(v.warnings.join()).toMatch(/総件数を読み取れませんでした/);
  });

  it("件数が解決できていれば従来どおり警告なしで取込める", () => {
    expect(
      evaluateMergedPages({ rows: 1250, entries: 1250, mergedPages: 2, expectedPages: 2, entriesUnknown: false }),
    ).toEqual({ warnings: [], autoImportBlocked: false });
  });

  it("件数不明＋0行なら両方の警告が出る", () => {
    const v = evaluateMergedPages({ rows: 0, entries: null, mergedPages: 1, expectedPages: 0, entriesUnknown: true });
    expect(v.warnings).toHaveLength(2);
    expect(v.autoImportBlocked).toBe(true);
  });
});

describe("対象定義の一本化（lib 正本 ⇔ CLI フォールバック）", () => {
  it("UI 用の一覧は対象定義から導出されている", () => {
    const defs = neAutoDownloadTargetDefs({});
    expect(NE_AUTO_DOWNLOAD_TARGETS.map((t) => t.key)).toEqual(defs.map((d) => d.key));
    expect(NE_AUTO_DOWNLOAD_TARGETS.map((t) => t.label)).toEqual(defs.map((d) => d.label));
    expect(NE_AUTO_DOWNLOAD_TARGETS.map((t) => t.searchUnit)).toEqual(defs.map((d) => d.searchTargetTexts[0]));
  });

  it("検索対象の選択肢（value 0/1/2）も対象定義から導出されている", () => {
    expect(NE_SEARCH_TARGET_OPTIONS.map((o) => o.value)).toEqual(["0", "1", "2"]);
    expect(NE_SEARCH_TARGET_OPTIONS.map((o) => o.text)).toEqual([
      "商品情報単位で検索",
      "セット商品情報単位で検索",
      "ページ情報単位で検索",
    ]);
  });

  it("probe の総当り対象は定義から導出され、env で寄せても既定3種を必ず含む", () => {
    expect(neProbeSearchTargets({}).map((t) => t.text)).toEqual(NE_SEARCH_TARGET_OPTIONS.map((o) => o.text));
    const withEnv = neProbeSearchTargets({ NE_MASTER_HIMODUKE_SEARCH_TARGET: "商品ページ単位で検索" });
    expect(withEnv.map((t) => t.text)).toContain("商品ページ単位で検索");
    for (const o of NE_SEARCH_TARGET_OPTIONS) expect(withEnv.map((t) => t.text)).toContain(o.text);
  });

  it("CLI フォールバックの対象定義が lib 正本とずれていない", () => {
    expect(script.DEFAULT_TARGET_DEFS).toEqual(neAutoDownloadTargetDefs({}));
    expect(script.NE_PAGE_ITEMS_DEFAULT).toBe(NE_PAGE_ITEMS_DEFAULT);
    expect(script.probeSearchTargetsFromDefs(neAutoDownloadTargetDefs({}))).toEqual(neProbeSearchTargets({}));
  });

  it("スクリプト側の件数解決が lib と同じ判断をする", () => {
    const cases = [
      { entries: 775, countText: "全775件中1-775を表示", rowCount: 775, pageItems: 1000 },
      { entries: null, countText: "全1250件中1-1000を表示", rowCount: 1000, pageItems: 1000 },
      { entries: null, countText: "", rowCount: 1000, pageItems: 1000 },
      { entries: null, countText: "", rowCount: 12, pageItems: 1000 },
      { entries: 0, countText: "", rowCount: 0, pageItems: 1000 },
      {},
    ];
    for (const c of cases) expect(script.resolveTotalEntries(c), JSON.stringify(c)).toEqual(resolveTotalEntries(c));
  });
});

describe("describePaginationLinks（失敗時に自己解決できる診断文）", () => {
  it("ページャの実体を1行にまとめる", () => {
    const text = script.describePaginationLinks([
      { tag: "a", type: "", text: "2", className: "page-link", dataPage: "2", disabled: false },
      { tag: "button", type: "button", text: "→", className: "next disabled", dataPage: null, disabled: true },
    ]);
    expect(text).toContain('a.page-link[data-page=2]"2"');
    expect(text).toContain("(disabled)");
  });

  it("リンクが無い（1ページ）ときも文字列を返す", () => {
    expect(script.describePaginationLinks([])).toBe("リンクなし");
  });
});
