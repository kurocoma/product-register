import { describe, it, expect } from "vitest";
import { countEmptyRequiredAttributes } from "./genre-attributes";

describe("countEmptyRequiredAttributes（値が空の必須属性の件数）", () => {
  it("必須で value が空の項目を数える", () => {
    const attrs = [
      { item: "内容量", value: "", unit: "ml", requirement: "必須" },
      { item: "アルコール度数", value: "", unit: "%", requirement: "必須" },
    ];
    expect(countEmptyRequiredAttributes(attrs)).toBe(2);
  });

  it("必須でも value が入っていれば数えない", () => {
    const attrs = [
      { item: "内容量", value: "720", unit: "ml", requirement: "必須" },
      { item: "アルコール度数", value: "", unit: "%", requirement: "必須" },
    ];
    expect(countEmptyRequiredAttributes(attrs)).toBe(1);
  });

  it("任意の項目は value が空でも数えない", () => {
    const attrs = [
      { item: "原産国/製造国", value: "", unit: "", requirement: "任意" },
      { item: "賞味期限", value: "", unit: "日", requirement: "" },
    ];
    expect(countEmptyRequiredAttributes(attrs)).toBe(0);
  });

  it("「いずれか必須」も必須系として数える", () => {
    const attrs = [{ item: "JANコード", value: "", unit: "", requirement: "いずれか必須" }];
    expect(countEmptyRequiredAttributes(attrs)).toBe(1);
  });

  it("空白のみの value は空として数える", () => {
    const attrs = [
      { item: "内容量", value: "   ", unit: "ml", requirement: "必須" },
      { item: "度数", value: "\t", unit: "%", requirement: "いずれか必須" },
    ];
    expect(countEmptyRequiredAttributes(attrs)).toBe(2);
  });

  it("value / requirement が undefined（フォーム入力途中）でも落ちない", () => {
    const attrs = [
      { item: "内容量", requirement: "必須" }, // value undefined = 空扱い
      { item: "何か", value: "x" }, // requirement undefined = 任意扱い
    ];
    expect(countEmptyRequiredAttributes(attrs)).toBe(1);
  });

  it("空配列は 0", () => {
    expect(countEmptyRequiredAttributes([])).toBe(0);
  });
});
