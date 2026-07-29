// 「検索結果が確定したか」の判定テスト（2026-07-30 実機で起きた2つの失敗の再発防止）。
//
// NE の結果コンテナは検索実行前から display:block で存在し（中身は空）、検索直後は
// 「全775件中0-0を表示」のように件数表記だけ先に入る段階を経由する。
// 可視になった瞬間を結果と見なした結果、実機では
//   1回目: container=search_syouhin_result / data-entries なし / 行数0 → 「0件」で中止
//   2回目: 「全775件中0-0を表示」を掴んで続行 → 行が無いまま全チェック→DL →
//          "Execution context was destroyed" でクラッシュ
// が発生した。行が入る（または明示的に0件と分かる）まで待つことを固定する。
import { describe, it, expect } from "vitest";
import * as scriptDefaults from "../../scripts/ne-master-defaults.mjs";

type Readiness = { settled: boolean; zero: boolean; reason: string };
const script = scriptDefaults as unknown as {
  evaluateSearchResultReadiness: (info: Record<string, unknown> | null) => Readiness;
};
const readiness = script.evaluateSearchResultReadiness;

describe("evaluateSearchResultReadiness", () => {
  it("観測できていないときは待つ", () => {
    expect(readiness(null).settled).toBe(false);
  });

  it("検索前の空コンテナ（件数属性なし・行0）は確定させない", () => {
    // 実機1回目の失敗そのもの。ここで確定すると 775 件を「0件」と誤判定する。
    const r = readiness({
      containerId: "search_syouhin_result",
      entries: null,
      pageItems: null,
      currentPage: 1,
      countText: "",
      rowCount: 0,
    });
    expect(r.settled).toBe(false);
    expect(r.zero).toBe(false);
  });

  it("描画途中（全775件中0-0を表示・行0）も確定させない", () => {
    // 実機2回目の失敗そのもの。ここで確定すると行が無いままダウンロードへ進んでクラッシュする。
    const r = readiness({
      containerId: "search_syouhin_result",
      entries: null,
      pageItems: 1000,
      currentPage: 1,
      countText: "全775件中0-0を表示",
      rowCount: 0,
    });
    expect(r.settled).toBe(false);
  });

  it("行が入ったら確定する", () => {
    const r = readiness({
      containerId: "search_syouhin_result",
      entries: 775,
      pageItems: 1000,
      currentPage: 1,
      countText: "全775件中1-775を表示",
      rowCount: 775,
    });
    expect(r).toMatchObject({ settled: true, zero: false });
  });

  it("data-entries=0 は本物の0件として確定する（待ち続けない）", () => {
    expect(readiness({ containerId: "search_setsyohin_result", entries: 0, rowCount: 0, countText: "" })).toMatchObject({
      settled: true,
      zero: true,
    });
  });

  it("件数表記が全0件なら本物の0件として確定する", () => {
    expect(
      readiness({ containerId: "search_setsyohin_result", entries: null, rowCount: 0, countText: "全0件中0-0を表示" }),
    ).toMatchObject({ settled: true, zero: true });
  });

  it("コンテナ非表示＋0件文言（entries:0）は0件として確定する", () => {
    expect(readiness({ containerId: null, entries: 0, rowCount: 0, countText: "" })).toMatchObject({
      settled: true,
      zero: true,
    });
  });

  it("コンテナも0件文言も無い状態は待つ", () => {
    expect(readiness({ containerId: null, entries: null, rowCount: 0, countText: "" }).settled).toBe(false);
  });

  it("判定理由を必ず返す（タイムアウト時の診断に使う）", () => {
    expect(readiness({ containerId: "x", entries: null, rowCount: 0, countText: "全775件中0-0を表示" }).reason).toBeTruthy();
  });
});
