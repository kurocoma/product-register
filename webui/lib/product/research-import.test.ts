import { describe, expect, it } from "vitest";
import { makeProduct } from "./schema";
import {
  APP_DRAFT_CONFIRMATION,
  diffResearchProduct,
  hashResearchImportPlan,
  parseResearchImportPayload,
} from "./research-import";

describe("parseResearchImportPayload", () => {
  it("defaults to dry-run and keeps selling_price tax-exclusive", () => {
    const result = parseResearchImportPayload({
      products: [makeProduct({ selling_price: 500 })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.products[0].selling_price).toBe(500);
    expect(result.productHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves fields absent from the 43-column bulk grid", () => {
    const result = parseResearchImportPayload({
      products: [
        makeProduct({
          free1: "タグなし商品情報",
          free2: "<p>商品説明</p>",
          variants: [
            {
              ne_code: "t002-2542-1",
              jan_code: "4955028002542",
              selling_price: 500,
              tax_rate: 10,
              quantity: 1,
              shipping_method_group: "4",
              individual_shipping_fee: "1050",
            },
          ],
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.products[0].free1).toBe("タグなし商品情報");
    expect(result.products[0].free2).toBe("<p>商品説明</p>");
    expect(result.products[0].variants[0].individual_shipping_fee).toBe("1050");
  });

  it("rejects a duplicate NE code in one payload", () => {
    const product = makeProduct();
    const result = parseResearchImportPayload({ products: [product, product] });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("requires explicit confirmation before commit and carries the expected plan hash", () => {
    const products = [makeProduct()];
    const preview = parseResearchImportPayload({ products });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const missingConfirmation = parseResearchImportPayload({
      products,
      dryRun: false,
      expectedHash: "preview-plan-hash",
    });
    expect(missingConfirmation).toMatchObject({ ok: false, status: 400 });

    const commit = parseResearchImportPayload({
      products,
      dryRun: false,
      confirmation: APP_DRAFT_CONFIRMATION,
      expectedHash: "preview-plan-hash",
    });
    expect(commit).toMatchObject({ ok: true, dryRun: false, expectedHash: "preview-plan-hash" });
  });

  it("binds overwrite intent and existing row versions into the plan hash", () => {
    const products = [makeProduct()];
    const state = [{ id: "id-1", ne_code: products[0].ne_code, updated_at: "2026-07-12T10:00:00Z" }];
    const preview = hashResearchImportPlan(products, false, state);

    expect(hashResearchImportPlan(products, true, state)).not.toBe(preview);
    expect(
      hashResearchImportPlan(products, false, [{ ...state[0], updated_at: "2026-07-12T10:01:00Z" }]),
    ).not.toBe(preview);
  });

  it("returns a reviewable full-replacement diff including defaulted fields", () => {
    const before = makeProduct({ free1: "既存の商品情報", selling_price: 500 });
    const after = makeProduct({ selling_price: 600 });
    const diff = diffResearchProduct(before, after);

    expect(diff.map((entry) => entry.field)).toEqual(expect.arrayContaining(["free1", "selling_price"]));
    expect(diff.find((entry) => entry.field === "free1")).toMatchObject({
      before: "既存の商品情報",
      after: "",
    });
  });

  it("normalizes NE-code whitespace and rejects a blank code", () => {
    const normalized = parseResearchImportPayload({
      products: [makeProduct({ ne_code: "  t002-2542-1  " })],
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.products[0].ne_code).toBe("t002-2542-1");

    const blank = parseResearchImportPayload({ products: [makeProduct({ ne_code: "   " })] });
    expect(blank).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects unknown top-level and nested fields instead of silently dropping them", () => {
    const product = makeProduct();
    const topLevel = parseResearchImportPayload({ products: [{ ...product, selling_prize: 500 }] });
    expect(topLevel).toMatchObject({ ok: false, status: 400 });

    const nested = parseResearchImportPayload({
      products: [
        {
          ...product,
          variants: [
            {
              ne_code: "t002-2542-1",
              jan_code: "4955028002542",
              selling_price: 500,
              tax_rate: 10,
              quantity: 1,
              individual_shipping_fie: "1050",
            },
          ],
        },
      ],
    });
    expect(nested).toMatchObject({ ok: false, status: 400 });
  });

  it("does not accept the research-only JANなし marker as app data", () => {
    const product = { ...makeProduct(), jan_code: "JANなし" };
    const result = parseResearchImportPayload({ products: [product] });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
