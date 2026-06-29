import { describe, it, expect } from "vitest";
import { safeStateDefaults } from "./defaults";

describe("safeStateDefaults", () => {
  it("publish=false は二重安全（display:0 / 在庫0 / 非公開）", () => {
    expect(safeStateDefaults(false)).toEqual({
      yahooDisplay: 0,
      stock: 0,
      registerPublish: false,
    });
  });

  it("publish=true は公開相当（display:1 / 在庫1 / 公開）", () => {
    expect(safeStateDefaults(true)).toEqual({
      yahooDisplay: 1,
      stock: 1,
      registerPublish: true,
    });
  });
});
