import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { fullWidthLen } from "@/lib/product/text-fit";
import { buildYahooEditItemParams, validateEditItemParams } from "./item-mapper";

const opts = { sellerId: "S" };

describe("buildYahooEditItemParams — フィールド文字数整形 (AC-F02/F03)", () => {
  it("長い display_name → name 全角75以内に整形 (it-01017)", () => {
    const p = makeProduct({ display_name: "あ".repeat(100) });
    const params = buildYahooEditItemParams(p, opts);
    expect(fullWidthLen(params.name)).toBeLessThanOrEqual(75);
    expect(fullWidthLen(params.name)).toBe(75);
  });

  it("HTML込み explanation → タグ除去後 全角500以内 (it-01033)", () => {
    const p = makeProduct({ free1: "<p>" + "強".repeat(600) + "</p>" });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.explanation).not.toContain("<");
    expect(fullWidthLen(params.explanation)).toBeLessThanOrEqual(500);
    expect(fullWidthLen(params.explanation)).toBe(500);
  });

  it("HTML込み headline → タグ除去後 全角30以内", () => {
    const p = makeProduct({ catch_copy_yahoo: "<span>" + "推".repeat(50) + "</span>" });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.headline).not.toContain("<");
    expect(fullWidthLen(params.headline)).toBeLessThanOrEqual(30);
    expect(fullWidthLen(params.headline)).toBe(30);
  });

  it("長い path（' > ' 区切り）→ 各セグメント全角20・':'区切り (it-01002)", () => {
    const p = makeProduct({
      yahoo_path: "あ".repeat(25) + " > " + "い".repeat(30) + " > " + "う".repeat(10),
    });
    const params = buildYahooEditItemParams(p, opts);
    const segs = params.path.split(":");
    expect(segs).toHaveLength(3);
    for (const seg of segs) {
      expect(fullWidthLen(seg)).toBeLessThanOrEqual(20);
    }
    expect(fullWidthLen(segs[0])).toBe(20);
    expect(fullWidthLen(segs[1])).toBe(20);
    expect(fullWidthLen(segs[2])).toBe(10);
  });

  it("path は8階層以内に制限する", () => {
    const p = makeProduct({
      yahoo_path: "L1 > L2 > L3 > L4 > L5 > L6 > L7 > L8 > L9 > L10",
    });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.path.split(":").length).toBeLessThanOrEqual(8);
    expect(params.path.split(":")).toHaveLength(8);
  });

  it("制限内の短い値は出力不変 (AC-F05)", () => {
    const p = makeProduct();
    const params = buildYahooEditItemParams(p, opts);
    expect(params.name).toBe(p.display_name);
    expect(params.path).toBe(p.yahoo_path);
    expect(params.headline).toBe(p.catch_copy_yahoo);
  });
});

describe("validateEditItemParams — 文字数違反・必須空の検知 (AC-F04)", () => {
  const base = {
    seller_id: "S",
    item_code: "c-1",
    path: "食品:酒",
    name: "商品名",
    product_category: "13457",
    price: "1000",
  };

  it("適合済みパラメータは ok", () => {
    expect(validateEditItemParams(base)).toEqual({ ok: true });
  });

  it("name 全角75超過を検知（shape は {ok,missing} を維持）", () => {
    const r = validateEditItemParams({ ...base, name: "あ".repeat(100) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.some((m) => m.includes("name"))).toBe(true);
  });

  it("path セグメント全角20超過を検知", () => {
    const r = validateEditItemParams({ ...base, path: "あ".repeat(25) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.some((m) => m.includes("path"))).toBe(true);
  });

  it("必須 path が空を検知", () => {
    const r = validateEditItemParams({ ...base, path: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.some((m) => m.includes("path"))).toBe(true);
  });
});
