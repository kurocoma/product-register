import { describe, it, expect } from "vitest";
import { parseManageNumbers } from "./manage-numbers";

describe("parseManageNumbers", () => {
  it("改行区切りを valid に正規化（前後空白除去・空行無視）", () => {
    const r = parseManageNumbers("  abc-123 \n\n  def_456\n");
    expect(r.valid).toEqual(["abc-123", "def_456"]);
    expect(r.invalid).toEqual([]);
    expect(r.duplicatesRemoved).toBe(0);
  });

  it("カンマ/CSV1列の混在を分割して受理", () => {
    const r = parseManageNumbers("a1,b2\r\nc3, d4");
    expect(r.valid).toEqual(["a1", "b2", "c3", "d4"]);
  });

  it("文字列配列入力（各要素をさらに改行/カンマで分割）", () => {
    const r = parseManageNumbers(["a1\nb2", "c3,d4"]);
    expect(r.valid).toEqual(["a1", "b2", "c3", "d4"]);
  });

  it("完全一致の重複を除去し件数を計上（出現順は保持）", () => {
    const r = parseManageNumbers("a1\nb2\na1\nb2\na1");
    expect(r.valid).toEqual(["a1", "b2"]);
    expect(r.duplicatesRemoved).toBe(3);
  });

  it("不正な文字種を invalid に理由付きで分類", () => {
    const r = parseManageNumbers("good-1\nあいう\nhas space\nslash/x");
    expect(r.valid).toEqual(["good-1"]);
    expect(r.invalid.map((x) => x.raw)).toEqual(["あいう", "has space", "slash/x"]);
    expect(r.invalid[0].reason).toContain("使用できない文字");
  });

  it("32文字超過は専用理由で invalid", () => {
    const long = "a".repeat(33);
    const r = parseManageNumbers(long);
    expect(r.valid).toEqual([]);
    expect(r.invalid).toEqual([{ raw: long, reason: "32文字を超えています" }]);
  });

  it("ちょうど32文字は valid", () => {
    const ok = "a".repeat(32);
    const r = parseManageNumbers(ok);
    expect(r.valid).toEqual([ok]);
  });

  it("大文字小文字は別物として扱う（重複にしない）", () => {
    const r = parseManageNumbers("Abc\nabc");
    expect(r.valid).toEqual(["Abc", "abc"]);
    expect(r.duplicatesRemoved).toBe(0);
  });

  it("空文字・空白のみは空結果", () => {
    expect(parseManageNumbers("   \n\n , ")).toEqual({
      valid: [],
      invalid: [],
      duplicatesRemoved: 0,
    });
  });

  it("invalid トークンの重複も除去して二重計上しない", () => {
    const r = parseManageNumbers("bad/x\nbad/x");
    expect(r.invalid.map((x) => x.raw)).toEqual(["bad/x"]);
    expect(r.duplicatesRemoved).toBe(1);
  });
});
