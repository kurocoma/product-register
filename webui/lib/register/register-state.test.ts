/** 登録後の状態（公開/現状維持/倉庫）の対応付けテスト（260720仕様変更の追補）。
 * 背景: 「倉庫に入れる」2値チェックでは (a) 新規をチェック無しで登録しても強制倉庫、
 * (b) 既存の倉庫商品をアプリから公開（倉庫解除）できない、の2つが表現できなかった
 * （a008-5015-out 実件: 親商品が倉庫のまま残った）。 */
import { describe, it, expect } from "vitest";
import { registerStateToOpts, defaultRegisterState } from "./register-state";

describe("registerStateToOpts", () => {
  it("publish = 公開で登録（倉庫から出す）", () => {
    expect(registerStateToOpts("publish")).toEqual({ publish: true });
  });

  it("keep = 既存の倉庫/公開状態を現状維持", () => {
    expect(registerStateToOpts("keep")).toEqual({ keepExistingState: true });
  });

  it("warehouse = 倉庫に入れる（従来の安全登録）", () => {
    expect(registerStateToOpts("warehouse")).toEqual({});
  });

  it("不明値は安全側（倉庫）に倒す", () => {
    expect(registerStateToOpts("unknown" as never)).toEqual({});
  });
});

describe("defaultRegisterState（画面の既定値）", () => {
  it("新規登録は倉庫（安全側）、既存上書きは現状維持", () => {
    expect(defaultRegisterState(false)).toBe("warehouse");
    expect(defaultRegisterState(true)).toBe("keep");
  });
});
