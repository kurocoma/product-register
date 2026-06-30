import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { YahooConverter } from "./yahoo";

/** 送料アイコン(delivery)を重量連動: ship-weight=100(送料無料)→1(無料), それ以外→0(なし)。 */
describe("YahooConverter — 送料アイコン(delivery) 重量連動", () => {
  it("送料無料(重量100) → delivery=1(無料)", () => {
    const row = new YahooConverter().convert([makeProduct({ shipping_type: "送料無料" })])[0];
    expect(row["ship-weight"]).toBe("100");
    expect(row["delivery"]).toBe("1");
  });
  it("送料別(重量1) → delivery=0(なし)", () => {
    const row = new YahooConverter().convert([makeProduct({ shipping_type: "送料別" })])[0];
    expect(row["ship-weight"]).toBe("1");
    expect(row["delivery"]).toBe("0");
  });
});
