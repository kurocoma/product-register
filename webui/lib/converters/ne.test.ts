import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { NEConverter } from "./ne";

const conv = new NEConverter();

describe("NEConverter", () => {
  it("returns { singles, sets }", () => {
    const result = conv.convert([
      makeProduct(),
      makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 }),
    ]);
    expect(result.singles).toHaveLength(1);
    expect(result.sets).toHaveLength(1);
  });

  it("singles required fields", () => {
    const { singles } = conv.convert([makeProduct()]);
    expect(singles[0].syohin_code).toBe("t002-2542-1");
    expect(singles[0].syohin_name).toBe("GIANTSボトル 10年貯蔵古酒 720ml 25度");
    expect(singles[0].baika_tnk).toBe("10000");
    expect(singles[0].sire_code).toBe("002");
    expect(singles[0].jan_code).toBe("4955028002542");
  });

  it("set row has set_syohin_code + construct single + suryo", () => {
    const { sets } = conv.convert([
      makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 }),
    ]);
    expect(sets[0].set_syohin_code).toBe("t002-2542-3");
    expect(sets[0].syohin_code).toBe("t002-2542-1");
    expect(sets[0].suryo).toBe("3");
  });

  it("set row does not have バッファ関数1 column", () => {
    const { sets } = conv.convert([
      makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 }),
    ]);
    expect("バッファ関数1" in sets[0]).toBe(false);
  });

  it("soryo_kbn: 送料無料 → 2", () => {
    const { singles } = conv.convert([makeProduct({ shipping_type: "送料無料" })]);
    expect(singles[0].soryo_kbn).toBe("2");
  });

  it("soryo_kbn: 送料別 → 1", () => {
    const { singles } = conv.convert([makeProduct({ shipping_type: "送料別" })]);
    expect(singles[0].soryo_kbn).toBe("1");
  });

  it("gazou_url1 uses ne_code", () => {
    const { singles } = conv.convert([makeProduct({ ne_code: "t002-2542-1", image_count: 3 })]);
    expect(singles[0].gazou_url1).toBe("https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/t002-2542-1.jpg");
  });

  it("gazou_url2 uses base_code for singles", () => {
    const { singles } = conv.convert([makeProduct({ ne_code: "t002-2542-1", image_count: 3 })]);
    expect(singles[0].gazou_url2).toBe("https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/t002-2542_2.jpg");
  });

  it("gazou_url2 uses full ne_code for sets", () => {
    const { sets } = conv.convert([
      makeProduct({
        ne_code: "t002-2542-3",
        product_type: "セット商品",
        quantity: 3,
        image_count: 3,
      }),
    ]);
    expect(sets[0].gazou_url2).toBe("https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/t002-2542-3_2.jpg");
  });
});
