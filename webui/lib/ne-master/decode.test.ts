import { describe, it, expect } from "vitest";
import { decodeCsvBytes } from "./decode";

describe("decodeCsvBytes", () => {
  it("UTF-8(BOMなし)をデコード", () => {
    expect(decodeCsvBytes(Buffer.from("商品,コード\n", "utf-8"))).toContain("商品");
  });
  it("UTF-8 BOMを除去", () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("あ", "utf-8")]);
    expect(decodeCsvBytes(b)).toBe("あ");
  });
  it("Shift-JIS(CP932)をデコード", () => {
    // 「日本」= 93 fa 96 7b
    expect(decodeCsvBytes(Buffer.from([0x93, 0xfa, 0x96, 0x7b]))).toBe("日本");
  });
});
