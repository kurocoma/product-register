import { describe, it, expect } from "vitest";
import { htmlToPlainText, fitFullWidthAndChars, fullWidthLen } from "./text-fit";

describe("htmlToPlainText (AC-N01)", () => {
  it("<br> / <br/> / <br /> / <BR> を半角空白へ変換する", () => {
    expect(htmlToPlainText("商品名<br>キーワード")).toBe("商品名 キーワード");
    expect(htmlToPlainText("a<br/>b")).toBe("a b");
    expect(htmlToPlainText("a<br />b")).toBe("a b");
    expect(htmlToPlainText("a<BR>b")).toBe("a b");
    expect(htmlToPlainText("a< br / >b")).toBe("a b");
  });
  it("その他のタグ(<b>等)は除去する", () => {
    expect(htmlToPlainText("<b>強</b>い<span>酒</span>")).toBe("強い酒");
  });
  it("<br>変換とタグ除去後に連続空白を1つへ畳み trim する", () => {
    expect(htmlToPlainText("  本来<br><br>  キーワード  ")).toBe("本来 キーワード");
    expect(htmlToPlainText("a <b></b> b")).toBe("a b");
  });
  it("出力に HTML 文字(< >)を含まない", () => {
    const r = htmlToPlainText("商品<br>名 <b>強</b> キーワード<br/>追加");
    expect(r).not.toContain("<");
    expect(r).not.toContain(">");
  });
  it("HTML 無し・余分な空白無しの値は不変", () => {
    expect(htmlToPlainText("純米大吟醸 720ml")).toBe("純米大吟醸 720ml");
  });
});

describe("fitFullWidthAndChars (AC-N02/N03)", () => {
  it("文字数(maxChars)で先に止まる(半角中心で幅は余る)", () => {
    // 半角10文字=幅5。maxFull=75・maxChars=5 → 5文字で停止。
    const r = fitFullWidthAndChars("abcdefghij", 75, 5);
    expect([...r].length).toBe(5);
    expect(r).toBe("abcde");
    expect(fullWidthLen(r)).toBeLessThanOrEqual(75);
  });
  it("幅(maxFull)で先に止まる(全角中心で文字数は余る)", () => {
    // 全角5文字=幅5。maxFull=3・maxChars=75 → 3文字(幅3)で停止。
    const r = fitFullWidthAndChars("あいうえお", 3, 75);
    expect(fullWidthLen(r)).toBeLessThanOrEqual(3);
    expect(r).toBe("あいう");
  });
  it("全角のみは文字数と幅が一致し両上限が同時に効く", () => {
    // 'あ'×100, maxFull=75・maxChars=75 → 75文字・幅75。
    const r = fitFullWidthAndChars("あ".repeat(100), 75, 75);
    expect([...r].length).toBe(75);
    expect(fullWidthLen(r)).toBe(75);
  });
  it("上限内はそのまま(短い値は不変)", () => {
    expect(fitFullWidthAndChars("あいう", 75, 75)).toBe("あいう");
  });
  it("境界でサロゲートペア(絵文字)を割らない", () => {
    const r = fitFullWidthAndChars("😀😀😀", 75, 2);
    expect([...r].length).toBe(2);
    expect(fullWidthLen(r)).toBe(2);
    expect([...r].every((c) => c.codePointAt(0)! >= 0x10000 || c.codePointAt(0)! < 0xd800)).toBe(true);
  });
  it("上限0は空", () => {
    expect(fitFullWidthAndChars("あいう", 0, 75)).toBe("");
    expect(fitFullWidthAndChars("あいう", 75, 0)).toBe("");
  });
});
