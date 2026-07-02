import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { detectYahooTruncations, countYahooField } from "./item-mapper";

/** 実障害の再現: name は「全角換算75」に加え「文字数(コードポイント)75」の二重上限
 * (maxChars)で切られるが、UI が全角換算しか見せないと「OK 表示なのに切られる」。
 * ここでは検出結果への charLen/maxChars 露出と、UI ライブカウンタ用 countYahooField を固定する。 */
describe("detectYahooTruncations — 文字数(maxChars)超過の露出", () => {
  it("商品名が全角換算75以内でも文字数75超 → name 検出（charLen/maxChars つき）", () => {
    // fw = 50 + 30*0.5 = 65 <= 75 だが、コードポイント数 80 > maxChars 75。
    const name = "あ".repeat(50) + "a".repeat(30);
    const t = detectYahooTruncations(makeProduct({ display_name: name }));
    const n = t.find((x) => x.field === "name");
    expect(n).toBeTruthy();
    expect(n!.fullWidthLen).toBe(65);
    expect(n!.charLen).toBe(80);
    expect(n!.maxChars).toBe(75);
    expect([...n!.fitted].length).toBe(75); // 文字数75で切られる
  });
});

describe("countYahooField — リライトUIのライブカウンタ（送信時と同じ規則）", () => {
  it("name: 全角換算OK・文字数超過を正しく判定する（実障害パターン）", () => {
    const c = countYahooField("name", "あ".repeat(50) + "a".repeat(30));
    expect(c.fullWidth).toBe(65);
    expect(c.chars).toBe(80);
    expect(c.limit).toBe(75);
    expect(c.maxChars).toBe(75);
    expect(c.overWidth).toBe(false);
    expect(c.overChars).toBe(true);
    expect(c.over).toBe(true);
  });
  it("name: 全角換算超過も判定する", () => {
    const c = countYahooField("name", "あ".repeat(80));
    expect(c.overWidth).toBe(true);
    expect(c.over).toBe(true);
  });
  it("name: <br> は空白1つに変換してから数える（送信時と同じ前処理）", () => {
    const c = countYahooField("name", "あ<br>い");
    expect(c.chars).toBe(3); // "あ い"
    expect(c.fullWidth).toBe(2.5);
    expect(c.over).toBe(false);
  });
  it("headline: 全角30上限・maxChars なし", () => {
    const c = countYahooField("headline", "あ".repeat(31));
    expect(c.limit).toBe(30);
    expect(c.maxChars).toBeUndefined();
    expect(c.overWidth).toBe(true);
    expect(c.overChars).toBe(false);
    expect(c.over).toBe(true);
  });
});
