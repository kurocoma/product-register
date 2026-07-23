import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { makeProduct, VariantSchema } from "@/lib/product/schema";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/product", async () => {
  const schema = await import("@/lib/product/schema");
  return {
    ...schema,
    getProduct: vi.fn(),
    dbRowToProductInput: vi.fn(),
    upsertProduct: vi.fn(),
  };
});
vi.mock("@/lib/rakuten", () => ({
  getRakutenCredentialsFromEnv: vi.fn(),
  getItem: vi.fn(),
}));
vi.mock("@/lib/yahoo", () => ({
  getYahooConfig: vi.fn(),
  getYahooAccessToken: vi.fn(),
  getItem: vi.fn(),
}));
vi.mock("@/lib/shopify", () => ({
  getShopifyConfig: vi.fn(),
  getProduct: vi.fn(),
}));

import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { dbRowToProductInput, getProduct, upsertProduct } from "@/lib/product";
import { getItem, getRakutenCredentialsFromEnv } from "@/lib/rakuten";

const REMOTE_SPECS = [{ label: "原産国", value: "日本" }];

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as Mock).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
  });
  (getProduct as Mock).mockResolvedValue({ id: "product-1" });
  (getRakutenCredentialsFromEnv as Mock).mockReturnValue({ serviceSecret: "dummy", licenseKey: "dummy" });
  (getItem as Mock).mockResolvedValue({
    exists: true,
    json: {
      title: "楽天上の商品名",
      genreId: "402930",
      payment: { taxRate: "0.1" },
      variants: {
        "sku-a": {
          merchantDefinedSkuId: "ne-a",
          standardPrice: "9999",
          articleNumber: { value: "4955028002542" },
          shipping: { postageIncluded: true },
          specs: REMOTE_SPECS,
        },
      },
    },
  });
  (upsertProduct as Mock).mockResolvedValue({ id: "product-1" });
});

describe("POST /api/fetch/rakuten/[id] SKU自由入力行readback", () => {
  it("specsだけを同期し、既存SKUの価格・在庫・配送を保持して保存する", async () => {
    const localVariant = VariantSchema.parse({
      sku_manage_number: "sku-a",
      ne_code: "ne-a",
      jan_code: "4955028002542",
      selling_price: 1234,
      stock_quantity: 37,
      shipping_type: "送料別",
      individual_shipping_fee: "800",
      specs: [{ label: "旧項目", value: "旧値" }],
    });
    const product = makeProduct({ rakuten_manage_number: "spec-item", variants: [localVariant] });
    (dbRowToProductInput as Mock).mockReturnValue(product);

    const response = await POST(new Request("http://localhost/api/fetch/rakuten/product-1", { method: "POST" }), {
      params: Promise.resolve({ mall: "rakuten", id: "product-1" }),
    });

    expect(response.status).toBe(200);
    const saved = (upsertProduct as Mock).mock.calls[0][1];
    expect(saved.variants[0]).toEqual({ ...localVariant, specs: REMOTE_SPECS });
  });

  it("旧フラット商品も合成SKUへspecsを同期し、価格・在庫を保持する", async () => {
    const product = makeProduct({
      rakuten_manage_number: "spec-item",
      rakuten_variant_id: "sku-a",
      ne_code: "ne-a",
      jan_code: "4955028002542",
      selling_price: 1234,
      stock_quantity: 37,
      shipping_type: "送料別",
    });
    (dbRowToProductInput as Mock).mockReturnValue(product);

    const response = await POST(new Request("http://localhost/api/fetch/rakuten/product-1", { method: "POST" }), {
      params: Promise.resolve({ mall: "rakuten", id: "product-1" }),
    });

    expect(response.status).toBe(200);
    const saved = (upsertProduct as Mock).mock.calls[0][1];
    expect(saved.variants).toHaveLength(1);
    expect(saved.variants[0]).toMatchObject({
      sku_manage_number: "sku-a",
      ne_code: "ne-a",
      selling_price: 1234,
      stock_quantity: 37,
      shipping_type: "送料別",
      specs: REMOTE_SPECS,
    });
  });
});
