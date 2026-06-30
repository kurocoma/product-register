import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { fullWidthLen } from "@/lib/product/text-fit";
import { buildYahooEditItemParams } from "./item-mapper";

const opts = { sellerId: "S" };

// 実データ風: 「本来の商品名 <br> SEOキーワード群(全角/半角/記号/数字 混在・多数)」
const REAL_NAME =
  "琉球 もろみ酢 430mg×93球（約1ヵ月分）<br>" +
  "しまのや クエン酸 アミノ酸 元気 健康 美容 ダイエット サプリメント " +
  "沖縄 発酵 黒酢 国産 送料無料 お試し 人気 ランキング 安心 安全 まとめ買い 特価";

describe("buildYahooEditItemParams — name 実データ整形 (AC-N01/N02/N03, it-01017)", () => {
  it("name に HTML(< >)を含まない", () => {
    const params = buildYahooEditItemParams(makeProduct({ display_name: REAL_NAME }), opts);
    expect(params.name).not.toContain("<");
    expect(params.name).not.toContain(">");
  });

  it("文字数<=75 かつ 全角換算<=75 に収まる(二重上限)", () => {
    const params = buildYahooEditItemParams(makeProduct({ display_name: REAL_NAME }), opts);
    expect([...params.name].length).toBeLessThanOrEqual(75);
    expect(fullWidthLen(params.name)).toBeLessThanOrEqual(75);
  });

  it("本来の商品名(先頭・短い)が保持され先頭に残る", () => {
    const params = buildYahooEditItemParams(makeProduct({ display_name: REAL_NAME }), opts);
    expect(params.name.startsWith("琉球 もろみ酢")).toBe(true);
  });

  it("<br> はキーワード区切りの空白として保持される", () => {
    const params = buildYahooEditItemParams(makeProduct({ display_name: REAL_NAME }), opts);
    // 本来商品名の直後(<br>変換)に空白が入り、キーワードと連結されない。
    expect(params.name).toContain("約1ヵ月分） しまのや");
  });

  it("短い name(HTML無・上限内)は不変", () => {
    const short = "純米大吟醸 720ml 25度";
    const params = buildYahooEditItemParams(makeProduct({ display_name: short }), opts);
    expect(params.name).toBe(short);
  });

  it("全角のみ('あ'×100)は文字数75・全角75(既存 fit テストと整合)", () => {
    const params = buildYahooEditItemParams(makeProduct({ display_name: "あ".repeat(100) }), opts);
    expect([...params.name].length).toBe(75);
    expect(fullWidthLen(params.name)).toBe(75);
  });
});
