import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { RakutenConverter } from "./rakuten";

const conv = new RakutenConverter();

describe("RakutenConverter", () => {
  it("manage number = base_code (maker + last 4 of JAN)", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0]["商品管理番号（商品URL）"]).toBe("t002-2542");
  });

  it("parent row has no SKU管理番号", () => {
    const rows = conv.convert([makeProduct()]);
    // 1 商品なら: 親 (SKU空) + 子 1
    expect(rows[0]["SKU管理番号"]).toBe("");
    expect(rows[1]["SKU管理番号"]).toBe("t002-2542-1");
  });

  it("バリエーションなし: SKU画像タイプ・パスは空（楽天は単一SKUにSKU画像を設定できない）", () => {
    const rows = conv.convert([makeProduct({ variation_key: "" })]);
    expect(rows[1]["SKU画像タイプ"]).toBe("");
    expect(rows[1]["SKU画像パス"]).toBe("");
  });

  it("バリエーションあり: SKU画像タイプ・パスを設定する", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "t002-2542-1", variation_key: "size", option_item_name: "720ml" }),
    ]);
    expect(rows[1]["SKU画像タイプ"]).toBe("CABINET");
    expect(rows[1]["SKU画像パス"]).toBe("/thum02/t002-2542-1.jpg");
  });

  it("parent + 2 children for single + set group", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "t002-2542-1", quantity: 1 }),
      makeProduct({ ne_code: "t002-2542-3", quantity: 3, product_type: "セット商品" }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]["商品管理番号（商品URL）"]).toBe("t002-2542");
    expect(rows[0]["SKU管理番号"]).toBe("");
    expect(rows[1]["SKU管理番号"]).toBe("t002-2542-1");
    expect(rows[2]["SKU管理番号"]).toBe("t002-2542-3");
  });

  it("tax rate: 10 → 0.1", () => {
    const rows = conv.convert([makeProduct({ tax_rate: 10 })]);
    expect(rows[0]["消費税率"]).toBe("0.1");
  });

  it("SP description starts with imgList", () => {
    const rows = conv.convert([makeProduct({ image_count: 3, description_sp: "SP本文" })]);
    const sp = rows[0]["スマートフォン用商品説明文"];
    expect(sp.startsWith("<!--imgList-->")).toBe(true);
    expect(sp.endsWith("SP本文")).toBe(true);
  });

  it("PC sale description = imgList only", () => {
    const rows = conv.convert([makeProduct({ image_count: 3, description_sp: "SP本文" })]);
    const sale = rows[0]["PC用販売説明文"];
    expect(sale).toContain("<!--imgList-->");
    expect(sale).not.toContain("SP本文");
  });

  it("image_count=1 → no _2.jpg in SP description", () => {
    const rows = conv.convert([makeProduct({ image_count: 1, description_sp: "SP本文" })]);
    expect(rows[0]["スマートフォン用商品説明文"]).toBe("SP本文");
    expect(rows[0]["PC用販売説明文"]).toBe("");
  });

  it("child has 販売価格 = selling_price", () => {
    const rows = conv.convert([makeProduct({ selling_price: 12345 })]);
    expect(rows[1]["販売価格"]).toBe("12345");
  });

  it("attribute_unit '0' becomes empty string", () => {
    // 値がある項目だけ出力される仕様。項目名と値を与えたうえで単位'0'→空を検証。
    const rows = conv.convert([
      makeProduct({ attribute_item_1: "容量", attribute_value_1: "720", attribute_unit_1: "0" }),
    ]);
    expect(rows[1]["商品属性（項目）1"]).toBe("容量");
    expect(rows[1]["商品属性（単位）1"]).toBe("");
  });

  it("outputs only attributes that have a value (空項目はCSVに出さない)", () => {
    const rows = conv.convert([
      makeProduct({
        attributes: [
          { item: "収録時間", value: "120", unit: "分" },
          { item: "メーカー型番", value: "", unit: "" }, // 値なし→出力されない
        ],
      }),
    ]);
    expect(rows[1]["商品属性（項目）1"]).toBe("収録時間");
    expect(rows[1]["商品属性（値）1"]).toBe("120");
    expect(rows[1]["商品属性（単位）1"]).toBe("分");
    expect(rows[1]["商品属性（項目）2"]).toBeUndefined();
  });

  it("multiple groups sorted by base_code ascending", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "n019-0250-1", jan_code: "4522814010250", maker_code: "n019" }),
      makeProduct({ ne_code: "t002-2542-1", jan_code: "4955028002542", maker_code: "t002" }),
    ]);
    expect(rows[0]["商品管理番号（商品URL）"]).toBe("n019-0250");
    expect(rows[2]["商品管理番号（商品URL）"]).toBe("t002-2542");
  });
});
