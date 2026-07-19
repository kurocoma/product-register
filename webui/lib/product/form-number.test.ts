/** フォーム数値入力の空欄セーフ変換（emptySafeNumber）のテスト。
 * 背景: valueAsNumber は空欄を NaN にし、ProductInputSchema.parse が失敗して
 * 自動保存が無言で止まる（IE0433 が消えない不具合の一因）。
 * 空欄・不正値は undefined に落とし、zod の default()/optional() に委ねる。 */
import { describe, expect, it } from "vitest";
import { emptySafeNumber } from "./form-number";

describe("emptySafeNumber", () => {
  it("空文字は undefined（default/optional に委ねる）", () => {
    expect(emptySafeNumber("")).toBe(undefined);
  });

  it("null / undefined は undefined", () => {
    expect(emptySafeNumber(null)).toBe(undefined);
    expect(emptySafeNumber(undefined)).toBe(undefined);
  });

  it("数値文字列は number に変換する", () => {
    expect(emptySafeNumber("2200")).toBe(2200);
    expect(emptySafeNumber("0")).toBe(0);
  });

  it("数値そのものはそのまま返す", () => {
    expect(emptySafeNumber(2445)).toBe(2445);
  });

  it("数値にならない文字列は undefined（NaN を流さない）", () => {
    expect(emptySafeNumber("12a")).toBe(undefined);
  });
});
