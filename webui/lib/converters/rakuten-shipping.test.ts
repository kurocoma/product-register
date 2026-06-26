import { describe, it, expect } from "vitest";
import type { Variant } from "../product/schema";
import { buildVariantShipping, buildVariantShippingForPatch } from "./rakuten-api";
import { detectVariantStructuralChange, variantKey } from "./rakuten-patch";

const V = (o: Partial<Variant>): Variant => ({
  sku_manage_number: "", ne_code: "", jan_code: "", selling_price: 0, tax_rate: 10, quantity: 1,
  variation_value: "", shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "",
  shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: [], ...o,
});

describe("buildVariantShipping (upsert, omit) — #4 送料無料でも配送方法セット併用", () => {
  it("送料無料 + 配送方法セット → postageIncluded:true と shippingMethodGroup 両方", () => {
    expect(buildVariantShipping(V({ shipping_type: "送料無料", shipping_method_group: "G1" })))
      .toEqual({ postageIncluded: true, shippingMethodGroup: "G1" });
  });
  it("送料無料(セット無し) → postageIncluded のみ", () => {
    expect(buildVariantShipping(V({ shipping_type: "送料無料" }))).toEqual({ postageIncluded: true });
  });
});

describe("buildVariantShippingForPatch (patch, null明示クリア)", () => {
  it("送料無料 → fee/postageSegment を null でクリア", () => {
    expect(buildVariantShippingForPatch(V({ shipping_type: "送料無料" })))
      .toEqual({ shippingMethodGroup: null, postageIncluded: true, fee: null, postageSegment: null });
  });
  it("送料別+個別送料 → postageSegment を null でクリア", () => {
    expect(buildVariantShippingForPatch(V({ shipping_type: "送料別", individual_shipping_fee: "300" })))
      .toEqual({ shippingMethodGroup: null, postageIncluded: false, fee: "300", postageSegment: null });
  });
  it("送料別+送料区分 → fee を null でクリア", () => {
    expect(buildVariantShippingForPatch(V({ shipping_type: "送料別", postage_segment_1: "1", shipping_method_group: "G9" })))
      .toEqual({ shippingMethodGroup: "G9", postageIncluded: false, fee: null, postageSegment: { local: 1 } });
  });
  it("送料別+無指定 → fee も postageSegment も null", () => {
    expect(buildVariantShippingForPatch(V({ shipping_type: "送料別" })))
      .toEqual({ shippingMethodGroup: null, postageIncluded: false, fee: null, postageSegment: null });
  });
});

describe("detectVariantStructuralChange (SKU追加/削除/空キー)", () => {
  const snap = [V({ sku_manage_number: "k1", ne_code: "n1" }), V({ sku_manage_number: "k2", ne_code: "n2" })];
  it("SKU追加を検出", () => {
    const r = detectVariantStructuralChange(snap, [...snap, V({ sku_manage_number: "k3", ne_code: "n3" })]);
    expect(r.added).toEqual(["k3"]);
    expect(r.removed).toEqual([]);
  });
  it("SKU削除を検出", () => {
    const r = detectVariantStructuralChange(snap, [snap[0]]);
    expect(r.removed).toEqual(["k2"]);
    expect(r.added).toEqual([]);
  });
  it("キー未入力(両方空)を検出", () => {
    const r = detectVariantStructuralChange(snap, [snap[0], V({})]);
    expect(r.emptyKey).toBe(true);
  });
  it("価格だけ変更(構成不変)は added/removed/emptyKey なし", () => {
    const r = detectVariantStructuralChange(snap, [{ ...snap[0], selling_price: 999 }, snap[1]]);
    expect(r).toEqual({ added: [], removed: [], emptyKey: false });
  });
  it("単品(variants未設定)は構成変更なし", () => {
    expect(detectVariantStructuralChange([], [])).toEqual({ added: [], removed: [], emptyKey: false });
  });
  it("variantKey は sku_manage_number 優先・無ければ ne_code・両方空は空文字", () => {
    expect(variantKey(V({ sku_manage_number: "a", ne_code: "b" }))).toBe("a");
    expect(variantKey(V({ ne_code: "b" }))).toBe("b");
    expect(variantKey(V({}))).toBe("");
  });
});
