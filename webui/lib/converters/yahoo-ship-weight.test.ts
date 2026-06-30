import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { YahooConverter } from "./yahoo";

/** 重量(ship-weight)運用ルール: 送料無料=100 / それ以外=1。 */
describe("YahooConverter — ship-weight 運用ルール", () => {
  it("送料無料 → ship-weight=100", () => {
    const row = new YahooConverter().convert([makeProduct({ shipping_type: "送料無料" })])[0];
    expect(row["ship-weight"]).toBe("100");
  });
  it("送料別 → ship-weight=1", () => {
    const row = new YahooConverter().convert([makeProduct({ shipping_type: "送料別" })])[0];
    expect(row["ship-weight"]).toBe("1");
  });
});
