import { describe, it, expect } from "vitest";
import { fullWidthLen, fitFullWidth, stripHtml } from "./text-fit";

describe("fullWidthLen", () => {
  it("全角=1（かな/漢字）", () => {
    expect(fullWidthLen("あいう")).toBe(3);
    expect(fullWidthLen("古酒")).toBe(2);
  });
  it("半角=0.5（ASCII）", () => {
    expect(fullWidthLen("abc")).toBe(1.5);
    expect(fullWidthLen("AB12")).toBe(2);
  });
  it("半角カナ=0.5", () => {
    expect(fullWidthLen("ｱｲｳ")).toBe(1.5);
  });
  it("全角+半角の混在", () => {
    expect(fullWidthLen("あa")).toBe(1.5);
    expect(fullWidthLen("720ml")).toBe(2.5);
  });
  it("絵文字(サロゲートペア)=1", () => {
    expect(fullWidthLen("😀")).toBe(1);
    expect(fullWidthLen("a😀")).toBe(1.5);
  });
  it("空文字=0", () => {
    expect(fullWidthLen("")).toBe(0);
  });
});

describe("fitFullWidth", () => {
  it("上限内はそのまま（短い値は不変）", () => {
    expect(fitFullWidth("あいう", 5)).toBe("あいう");
    expect(fitFullWidth("abc", 10)).toBe("abc");
  });
  it("上限ちょうどで全て収まる", () => {
    expect(fitFullWidth("あいう", 3)).toBe("あいう");
  });
  it("超過分を末尾から切る（全角）", () => {
    expect(fitFullWidth("あいうえお", 3)).toBe("あいう");
  });
  it("半角は0.5幅で数える（超過1）", () => {
    // 0.5*5=2.5 だが上限2 → 4文字=2.0 まで
    expect(fitFullWidth("aaaaa", 2)).toBe("aaaa");
  });
  it("全角文字を割らない（境界で全角が入らなければ手前で止める）", () => {
    // あ=1.0, い を入れると 2.0 > 1.5 → "あ" のみ（半端な分割をしない）
    const r = fitFullWidth("あい", 1.5);
    expect(r).toBe("あ");
    expect(fullWidthLen(r)).toBeLessThanOrEqual(1.5);
  });
  it("サロゲートペアを壊さない", () => {
    const r = fitFullWidth("😀😀😀", 2);
    expect(Array.from(r).length).toBe(2);
    expect(fullWidthLen(r)).toBe(2);
    // 壊れた孤立サロゲートを含まない
    expect([...r].every((c) => c.codePointAt(0)! >= 0x10000 || c.codePointAt(0)! < 0xd800)).toBe(true);
  });
  it("上限0は空", () => {
    expect(fitFullWidth("あいう", 0)).toBe("");
  });
});

describe("stripHtml", () => {
  it("タグを除去しテキストだけ残す", () => {
    expect(stripHtml("<b>強</b>い<br/>酒")).toBe("強い酒");
  });
  it("タグ無しは不変", () => {
    expect(stripHtml("純米大吟醸")).toBe("純米大吟醸");
  });
});
