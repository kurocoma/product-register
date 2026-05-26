import { describe, it, expect } from "vitest";
import { writeCsv } from "./writer";

describe("writeCsv", () => {
  it("utf-8-sig prepends BOM", () => {
    const buf = writeCsv([{ a: "1", b: "2" }], "utf-8-sig");
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(buf.toString("utf-8").slice(1)).toContain("a,b");
  });

  it("utf-8 no BOM", () => {
    const buf = writeCsv([{ a: "1", b: "2" }], "utf-8");
    expect(buf.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
    expect(buf.toString("utf-8")).toContain("a,b");
  });

  it("cp932 encodes Japanese, no BOM", () => {
    const buf = writeCsv([{ 商品名: "ちんすこう" }], "cp932");
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
  });

  it("empty rows returns empty buffer", () => {
    const buf = writeCsv([], "utf-8");
    expect(buf.length).toBe(0);
  });

  it("uses CRLF record separator", () => {
    const buf = writeCsv([{ a: "1" }, { a: "2" }], "utf-8");
    const str = buf.toString("utf-8");
    expect(str).toContain("a\r\n1\r\n2");
  });
});
