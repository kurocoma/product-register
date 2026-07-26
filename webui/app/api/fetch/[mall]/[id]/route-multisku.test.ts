import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// 多SKUページの「モール取込(fetch)」で、どのSKUのフラット項目を取込むかの回帰テスト。
// 260726実件: merchantSku を渡していなかったため variants の先頭SKU（API応答順＝不定）が採用され、
// 1袋商品(r3001-1 2445円)に5袋の価格(11000円)・JAN・配送・定期価格が上書きされた。
// この取込値はそのまま Yahoo へ反映されるため、価格破壊に直結する。

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/product", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/product")>();
  return { ...actual, getProduct: vi.fn(), upsertProduct: vi.fn(), dbRowToProductInput: vi.fn() };
});
vi.mock("@/lib/rakuten", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rakuten")>();
  return { ...actual, getRakutenCredentialsFromEnv: vi.fn(), getItem: vi.fn() };
});

import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { getProduct, upsertProduct, dbRowToProductInput, ProductInputSchema, type ProductInput } from "@/lib/product";
import { getRakutenCredentialsFromEnv, getItem as getRakutenItem } from "@/lib/rakuten";

/** 1袋のSKU（この商品自身）。ページには3袋・5袋のSKUも同居する。 */
const OWN_SKU = "x-1";

function makeProduct(): ProductInput {
  return ProductInputSchema.parse({
    ne_code: OWN_SKU,
    jan_code: "4900000000001",
    maker_code: "m",
    product_type: "単品",
    quantity: 1,
    product_name: "テスト商品",
    display_name: "テスト商品 1袋",
    tax_rate: 8,
    cost_price: 0,
    selling_price: 1000,
    shipping_type: "送料別",
    image_count: 1,
    delivery_method: 1,
    lead_time: 1,
    mall_category_id: "0",
    rakuten_manage_number: "x-1",
  });
}

/** 楽天 items.get 相当。variants の**先頭が5袋**＝バグがあると5袋の値が取込まれる並び。 */
function makeRakutenJson() {
  const variant = (msku: string, price: string, jan: string, postageIncluded: boolean) => ({
    merchantDefinedSkuId: msku,
    standardPrice: price,
    articleNumber: { value: jan },
    shipping: { postageIncluded },
    attributes: [],
  });
  return {
    title: "テスト商品",
    genreId: "12345",
    payment: { taxRate: "0.08" },
    variants: {
      "x-5": variant("x-5", "5000", "4900000000005", true),
      "x-3": variant("x-3", "3000", "4900000000003", true),
      [OWN_SKU]: variant(OWN_SKU, "1000", "4900000000001", false),
    },
  };
}

const supabase = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) } };

beforeEach(() => {
  vi.clearAllMocks();
  (createClient as Mock).mockResolvedValue(supabase);
  (getRakutenCredentialsFromEnv as Mock).mockReturnValue({ serviceSecret: "s", licenseKey: "l" });
  (getRakutenItem as Mock).mockResolvedValue({ exists: true, json: makeRakutenJson() });
  const product = makeProduct();
  (getProduct as Mock).mockResolvedValue({ id: "p1", user_id: "user-1", extra: {}, ...product });
  // dbRowToProductInput は実体を使わず、上で作った ProductInput をそのまま返す
  (dbRowToProductInput as Mock).mockReturnValue(product);
  (upsertProduct as Mock).mockImplementation(async (_c: unknown, p: ProductInput) => ({ id: "p1", ...p }));
});

const req = (method: string) => new Request("http://localhost/api/fetch/rakuten/p1", { method });
const params = { params: Promise.resolve({ mall: "rakuten", id: "p1" }) };

describe("GET/POST /api/fetch/rakuten/:id — 多SKUページのフラット項目は「その商品のSKU」から取込む", () => {
  it("GET(プレビュー): 先頭SKU(5袋)ではなく自SKU(1袋)の価格・JAN・配送を返す", async () => {
    const res = await GET(req("GET"), params);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.parsed.selling_price).toBe(1000); // 5000 だと別SKUの価格を掴んでいる
    expect(j.parsed.jan_code).toBe("4900000000001");
    expect(j.parsed.shipping_type).toBe("送料別"); // 5袋は送料無料
    expect(j.parsed.rakuten_variant_id).toBe(OWN_SKU);
  });

  it("POST(取込確定): 保存される商品の価格・JANが自SKUの値になる", async () => {
    const res = await POST(req("POST"), params);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    const saved = (upsertProduct as Mock).mock.calls[0][1] as ProductInput;
    expect(saved.selling_price).toBe(1000);
    expect(saved.jan_code).toBe("4900000000001");
    expect(saved.ne_code).toBe(OWN_SKU); // 識別子は取込で書き換えない
  });

  it("自SKUがページに無い場合は従来どおり先頭SKUへフォールバックする（取込を止めない）", async () => {
    const orphan = { ...makeProduct(), ne_code: "zzz-not-on-page" };
    (getProduct as Mock).mockResolvedValue({ id: "p1", user_id: "user-1", extra: {}, ...orphan });
    (dbRowToProductInput as Mock).mockReturnValue(orphan);
    const res = await GET(req("GET"), params);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.parsed.selling_price).toBe(5000);
  });
});
