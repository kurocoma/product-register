import { describe, it, expect } from "vitest";
import { buildItemFromNeSet, buildMallCodes, buildItemFromExcelDiscon } from "./build";

describe("build", () => {
  it("セット: 構成展開とsuryo合算・is_set・売価=set_price", () => {
    const { items, comps } = buildItemFromNeSet([
      { set_ne_code: "a008-4032-3", daihyo_code: "", set_name: "青切り", set_price: 6286, tax_rate: 8, component_ne_code: "a008-4032-1", suryo: 3, jan_code: "" },
    ]);
    expect(items[0]).toMatchObject({ ne_code: "a008-4032-3", is_set: true, selling_price: 6286, source: "ne_set" });
    expect(comps[0]).toMatchObject({ set_ne_code: "a008-4032-3", component_ne_code: "a008-4032-1", suryo: 3 });
  });

  it("セット: 同一(set,component)はsuryo合算", () => {
    const { comps } = buildItemFromNeSet([
      { set_ne_code: "s1", daihyo_code: "", set_name: "n", set_price: 1, tax_rate: 8, component_ne_code: "c1", suryo: 2, jan_code: "" },
      { set_ne_code: "s1", daihyo_code: "", set_name: "n", set_price: 1, tax_rate: 8, component_ne_code: "c1", suryo: 3, jan_code: "" },
    ]);
    expect(comps).toHaveLength(1);
    expect(comps[0].suryo).toBe(5);
  });

  it("楽天モールコード: ne_code直結", () => {
    const { records, unmatched } = buildMallCodes([{ manage_no: "aogiri-sh2", ne_code: "a008-4032-3", jan_code: "4582218324032", suryo: 3 }], "rakuten", () => null);
    expect(records[0]).toMatchObject({ ne_code: "a008-4032-3", mall: "rakuten", manage_no: "aogiri-sh2" });
    expect(unmatched).toBe(0);
  });

  it("Yahooモールコード: ne列なし→JAN+数量解決, 未解決はunmatched", () => {
    const resolver = (jan: string, qty: number | null) => (jan === "4582218324032" && qty === 3 ? "a008-4032-3" : null);
    const { records, unmatched } = buildMallCodes(
      [
        { manage_no: "y1", ne_code: "", jan_code: "4582218324032", suryo: 3 },
        { manage_no: "y2", ne_code: "", jan_code: "9999999999999", suryo: 1 },
      ],
      "yahoo",
      resolver,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ne_code: "a008-4032-3", mall: "yahoo", manage_no: "y1" });
    expect(unmatched).toBe(1);
  });

  it("終売: is_discontinued パッチ", () => {
    expect(buildItemFromExcelDiscon(["x-1"])).toEqual([{ ne_code: "x-1", is_discontinued: true, source: "excel_discon" }]);
  });
});
