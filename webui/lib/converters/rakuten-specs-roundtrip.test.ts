import { describe, expect, it } from "vitest";
import { ProductInputSchema, VariantSchema, makeProduct } from "@/lib/product/schema";
import { buildImportedProduct } from "./mall-import";
import { buildRakutenUpsertBody } from "./rakuten-api";
import { mergeRakutenVariantSpecs, parseRakutenItem, parseRakutenVariants } from "./rakuten-item-parser";
import { buildRakutenPatchBody, diffVariants } from "./rakuten-patch";
import { RakutenConverter } from "./rakuten";

const SPECS = [
  { label: "原産国", value: "日本" },
  { label: "保存方法", value: "直射日光を避けて保存" },
];

function rakutenItem(specs: unknown = SPECS): Record<string, unknown> {
  return {
    title: "自由入力行テスト商品",
    genreId: "402930",
    payment: { taxRate: "0.1" },
    variants: {
      "sku-specs": {
        merchantDefinedSkuId: "sku-specs",
        standardPrice: "1000",
        articleNumber: { value: "4955028002542" },
        shipping: { postageIncluded: true },
        specs,
      },
    },
  };
}

describe("楽天SKU自由入力行の往復", () => {
  it("items.get → ProductInput → upsert payload / RMS CSVへ同じ順序で往復する", () => {
    const variants = parseRakutenVariants(rakutenItem());
    const parsed = { ...parseRakutenItem(rakutenItem()), variants };
    expect(variants[0].specs).toEqual(SPECS);

    const built = buildImportedProduct("rakuten", "spec-item", parsed);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const product = built.product;
    expect(product.variants[0].specs).toEqual(SPECS);

    const body = buildRakutenUpsertBody(product);
    expect((body.variants as Record<string, { specs?: unknown }>)["sku-specs"].specs).toEqual(SPECS);

    const rows = new RakutenConverter().convert([product]);
    const child = rows.find((row) => row["SKU管理番号"] === "sku-specs");
    expect(child?.["自由入力行（項目）1"]).toBe("原産国");
    expect(child?.["自由入力行（値）1"]).toBe("日本");
    expect(child?.["自由入力行（項目）2"]).toBe("保存方法");
    expect(child?.["自由入力行（値）2"]).toBe("直射日光を避けて保存");
  });

  it("未設定・空配列のupsertは全置換で既存値を曖昧にしないよう specs: [] を送る", () => {
    for (const specs of [undefined, []] as const) {
      const product = makeProduct({
        variants: [VariantSchema.parse({ sku_manage_number: "sku-a", ne_code: "sku-a", selling_price: 1000, specs })],
      });
      const variant = (buildRakutenUpsertBody(product).variants as Record<string, Record<string, unknown>>)["sku-a"];
      expect(variant.specs).toEqual([]);
    }
  });

  it("readback mergeはSKU管理番号を優先し、価格・在庫・配送を保持する", () => {
    const local = VariantSchema.parse({
      sku_manage_number: "sku-a",
      ne_code: "ne-a",
      selling_price: 1234,
      stock_quantity: 37,
      shipping_type: "送料別",
      individual_shipping_fee: "800",
      specs: [{ label: "旧項目", value: "旧値" }],
    });
    const remote = VariantSchema.parse({
      sku_manage_number: "sku-a",
      ne_code: "different-ne",
      selling_price: 9999,
      stock_quantity: 0,
      shipping_type: "送料無料",
      specs: SPECS,
    });

    const [merged] = mergeRakutenVariantSpecs([local], [remote]);
    expect(merged).toEqual({ ...local, specs: SPECS });

    const neFallback = mergeRakutenVariantSpecs(
      [{ ...local, sku_manage_number: "legacy-key" }],
      [{ ...remote, sku_manage_number: "remote-key", ne_code: "ne-a" }],
    )[0];
    expect(neFallback.specs).toEqual(SPECS);
    expect(neFallback.stock_quantity).toBe(37);
  });

  it("patchは未管理(undefined)なら楽天既存値を保持し、編集・明示削除は反映する", () => {
    const snapshot = makeProduct({
      variants: [VariantSchema.parse({ sku_manage_number: "sku-a", ne_code: "sku-a", selling_price: 1000, specs: SPECS })],
    });

    const legacyEdited = ProductInputSchema.parse({
      ...snapshot,
      variants: [{ ...snapshot.variants[0], selling_price: 1100, specs: undefined }],
    });
    const legacyChanged = diffVariants(snapshot.variants, legacyEdited.variants);
    const legacyVariant = (
      buildRakutenPatchBody(legacyChanged, legacyEdited, snapshot).body.variants as Record<string, Record<string, unknown>>
    )["sku-a"];
    expect(legacyVariant.standardPrice).toBe("1100");
    expect(legacyVariant).not.toHaveProperty("specs");

    const edited = ProductInputSchema.parse({
      ...snapshot,
      variants: [{ ...snapshot.variants[0], specs: [{ label: "原産国", value: "沖縄県" }] }],
    });
    const changed = diffVariants(snapshot.variants, edited.variants);
    expect(changed.map((entry) => entry.field)).toContain("SKU[sku-a].自由入力行");
    expect(
      ((buildRakutenPatchBody(changed, edited, snapshot).body.variants as Record<string, Record<string, unknown>>)["sku-a"])
        .specs,
    ).toEqual([{ label: "原産国", value: "沖縄県" }]);

    const cleared = ProductInputSchema.parse({
      ...snapshot,
      variants: [{ ...snapshot.variants[0], specs: [] }],
    });
    const clearChanged = diffVariants(snapshot.variants, cleared.variants);
    expect(
      ((buildRakutenPatchBody(clearChanged, cleared, snapshot).body.variants as Record<string, Record<string, unknown>>)["sku-a"])
        .specs,
    ).toEqual([]);
  });
});
