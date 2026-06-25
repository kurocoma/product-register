import { describe, it, expect } from "vitest";
import { parseTokens, resolveTokens, assembleRelated, relatedToCsv } from "./related";

describe("related", () => {
  it("parseTokens: 改行/カンマ/空白区切り・trim・重複排除", () => {
    expect(parseTokens("n050-3426-1, 4582469493426\nn050-3426-1  x")).toEqual(["n050-3426-1", "4582469493426", "x"]);
  });

  it("resolveTokens: コード一致 / JAN一致(1対多) / 未解決", () => {
    const items = [
      { ne_code: "n050-3426-1", jan_code: "4582469493426" },
      { ne_code: "n050-3426-3", jan_code: "4582469493426" },
      { ne_code: "x-1", jan_code: "" },
    ];
    const { resolved, notFound } = resolveTokens(["n050-3426-1", "4582469493426", "zzz"], items);
    expect(resolved.get("n050-3426-1")).toEqual(["n050-3426-1"]);
    expect(resolved.get("4582469493426")?.sort()).toEqual(["n050-3426-1", "n050-3426-3"]);
    expect(notFound).toEqual(["zzz"]);
  });

  it("assembleRelated: セット単位・構成品・モールコード・紐づけ漏れ", () => {
    const s2s = [
      { single: "n050-3426-1", set_ne_code: "n050-3419-s01" },
      { single: "n050-3426-1", set_ne_code: "IL-4CUI-5DAZ" },
    ];
    const comps = [
      { set_ne_code: "n050-3419-s01", component_ne_code: "n050-3426-1", suryo: 1, set_name: "詰替セット", set_price: 3120 },
      { set_ne_code: "n050-3419-s01", component_ne_code: "n050-3419-1", suryo: 1, set_name: "詰替セット", set_price: 3120 },
      { set_ne_code: "IL-4CUI-5DAZ", component_ne_code: "n050-3426-1", suryo: 1, set_name: "4点セット", set_price: 7156 },
    ];
    const malls = [{ ne_code: "n050-3419-s01", mall: "rakuten", manage_no: "n050-3419-s01" }];
    const out = assembleRelated(s2s, comps, malls);
    expect(out.map((o) => o.set_ne_code)).toEqual(["IL-4CUI-5DAZ", "n050-3419-s01"]); // sorted
    const a = out.find((o) => o.set_ne_code === "n050-3419-s01")!;
    expect(a.set_price).toBe(3120);
    expect(a.components.map((c) => c.ne_code)).toEqual(["n050-3419-1", "n050-3426-1"]);
    expect(a.mall_codes.rakuten).toBe("n050-3419-s01");
    expect(a.missing_link).toBe(false);
    const b = out.find((o) => o.set_ne_code === "IL-4CUI-5DAZ")!;
    expect(b.missing_link).toBe(true); // モールコードなし
  });

  it("relatedToCsv: ヘッダ+1行/構成品結合/紐づけ漏れ○", () => {
    const csv = relatedToCsv([
      { set_ne_code: "s1", set_name: "名,カンマ", set_price: 100, components: [{ ne_code: "c1", suryo: 2 }], mall_codes: {}, matched_singles: ["x"], missing_link: true },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("セット商品コード");
    expect(lines[1]).toContain('"名,カンマ"'); // カンマはクォート
    expect(lines[1]).toContain("c1×2");
    expect(lines[1].endsWith("○")).toBe(true);
  });
});
