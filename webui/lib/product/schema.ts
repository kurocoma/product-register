import { z } from "zod";

const imageUrls = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [`image_url_${i + 1}`, z.string().default("")]),
) as Record<string, z.ZodDefault<z.ZodString>>;

const attributes = Object.fromEntries(
  Array.from({ length: 5 }, (_, i) => i + 1).flatMap((i) => [
    [`attribute_item_${i}`, z.string().default("")],
    [`attribute_value_${i}`, z.string().default("")],
    [`attribute_unit_${i}`, z.string().default("")],
  ]),
) as Record<string, z.ZodDefault<z.ZodString>>;

export const ProductInputSchema = z
  .object({
    // 基本情報
    ne_code: z.string(),
    jan_code: z.string().regex(/^\d{13}$/, "jan_code must be 13 digits"),
    maker_code: z.string(),
    product_type: z.enum(["単品", "セット商品"]),
    quantity: z.number().int(),
    product_name: z.string(),
    display_name: z.string(),
    tax_rate: z.union([z.literal(8), z.literal(10)]),
    cost_price: z.number().int().default(0),
    selling_price: z.number().int(),

    // 配送・カテゴリ
    shipping_type: z.string(),
    image_count: z.number().int(),
    delivery_method: z.number().int(),
    lead_time: z.number().int(),
    mall_category_id: z.string(),
    store_category: z.string().default(""),

    // 商品説明
    catch_copy_pc: z.string().default(""),
    catch_copy_yahoo: z.string().default(""),
    description_pc: z.string().default(""),
    description_sp: z.string().default(""),
    description_4: z.string().default(""),
    free1: z.string().default(""),
    free2: z.string().default(""),
    keyword: z.string().default(""),
    maker_name: z.string().default(""),
    brand_name: z.string().default(""),

    // Yahoo 固有
    yahoo_category_id: z.string().default(""),
    yahoo_path: z.string().default(""),
    unit: z.string().default(""),
    yahoo_grouping_enabled: z.boolean().default(false),
    yahoo_variation_title: z.string().default(""),

    // バリエーション
    option_item_name: z.string().default(""),
    option_horizontal: z.string().default(""),
    variation_key: z.string().default(""),
    variation_name: z.string().default(""),
    variation_choices: z.string().default(""),
    choice_numbers: z.string().default(""),

    ...imageUrls,
    ...attributes,
  })
  .transform((p) => ({
    ...p,
    is_single: p.product_type === "単品",
    is_set: p.product_type === "セット商品",
  }));

export type ProductInput = z.infer<typeof ProductInputSchema>;

/** テスト用ファクトリ (Phase 1 conftest.make_product と同等) */
export function makeProduct(
  overrides: Partial<z.input<typeof ProductInputSchema>> = {},
): ProductInput {
  return ProductInputSchema.parse({
    ne_code: "t002-2542-1",
    jan_code: "4955028002542",
    maker_code: "t002",
    product_type: "単品",
    quantity: 1,
    product_name: "GIANTSボトル 10年貯蔵古酒 720ml 25度",
    display_name: "巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
    tax_rate: 10,
    selling_price: 10000,
    shipping_type: "送料無料",
    image_count: 3,
    delivery_method: 4,
    lead_time: 1,
    mall_category_id: "402930",
    store_category: "沖縄のお酒",
    yahoo_category_id: "41383",
    yahoo_path: "沖縄のお酒",
    catch_copy_pc: "毎年完売必須 プロ野球 人気のボトル",
    catch_copy_yahoo: "毎年完売 プロ野球ボトル",
    unit: "本",
    yahoo_grouping_enabled: false,
    yahoo_variation_title: "数量",
    ...overrides,
  });
}
