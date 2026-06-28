import { z } from "zod";

/** 商品属性(ジャンル必須属性等)の1項目。product共通・variant単位の双方で使う。 */
export const AttributeSchema = z.object({
  item: z.string().default(""),
  value: z.string().default(""),
  unit: z.string().default(""),
  requirement: z.string().default(""), // 必須/いずれか必須/任意（UI強調用。CSV出力には影響しない）
});

/** SKU(variant)単位の項目。1商品ページ(楽天 商品管理番号)に複数SKUがぶら下がるケースで使う。
 * 商品ページ共通(名前・説明・画像・カテゴリ)は ProductInput 側に残し、SKUごとに変わる
 * 識別子・価格・配送をここに持つ。後方互換: variants 未設定なら productVariants() がフラットから1件合成。 */
export const VariantSchema = z.object({
  sku_manage_number: z.string().default(""), // 楽天 variant キー(SKU管理番号) = 旧 rakuten_variant_id
  ne_code: z.string().default(""),           // 各SKUのNEコード(=システム連携用SKU番号 merchantDefinedSkuId)
  jan_code: z.string().default(""),
  selling_price: z.number().int().default(0),
  // SKU別の表示価格(二重価格)。未設定/0 なら販売価格に連動(displayPrice相当)。optional=既存variant互換。
  display_price: z.number().int().optional(),
  tax_rate: z.union([z.literal(8), z.literal(10)]).default(10),
  quantity: z.number().int().default(1),
  variation_value: z.string().default(""),   // バリエーション項目選択肢ラベル(例 "1本"/"詰替セット")
  // 配送(SKU別、#3)。楽天 variant.shipping へマッピングする。
  shipping_type: z.string().default("送料別"),     // 送料無料/別 → postageIncluded
  postage_segment_1: z.string().default(""),       // 送料区分1(postageSegment.local)
  postage_segment_2: z.string().default(""),       // 送料区分2(postageSegment.overseas)
  shipping_method_group: z.string().default(""),   // 配送方法セットID(shippingMethodGroup)
  individual_shipping_fee: z.string().default(""), // 個別送料(shipping.fee)
  okihai: z.boolean().default(true),               // 置き配 受付
  attributes: z.array(AttributeSchema).default([]),
});

/** base スキーマ (派生フィールドなし、 react-hook-form の resolver 用) */
export const ProductInputBaseSchema = z.object({
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
  // 表示価格(二重価格)。0/未設定なら販売価格に連動する（displayPrice() がフォールバック）。
  // 一覧の販売価格を編集すると同額に同期、表示価格だけ手動上書きも可。
  display_price: z.number().int().default(0),

  // 配送・カテゴリ
  shipping_type: z.string(),
  image_count: z.number().int(),
  delivery_method: z.number().int(),
  lead_time: z.number().int(),
  mall_category_id: z.string(),
  store_category: z.string().default(""),
  // モール識別子: 取込商品の実際の楽天 商品管理番号。
  // 非規約書式(maker-JAN下4桁以外)でも編集→反映で同一商品へ往復させるため保存する。
  // 空のとき buildRakutenManageNumber は従来どおり baseCodeOf を使う（新規登録・既存商品は後方互換）。
  rakuten_manage_number: z.string().default(""),
  // 楽天 variant キー(SKU管理番号)。NEコード(=merchantDefinedSkuId)と別物の外部作成商品で、
  // upsert/patch の variants.{key} に使う実キーを保持する。空のとき ne_code を使う（後方互換）。
  rakuten_variant_id: z.string().default(""),

  // 多SKU(variants[]): 1商品ページ(楽天 商品管理番号)配下の複数SKU。未設定(空配列)なら単品=従来動作。
  // 消費側は productVariants() 経由で段階移行する(フラットから1件合成する後方互換あり)。
  variants: z.array(VariantSchema).default([]),

  // 商品説明
  catch_copy_pc: z.string().default(""),
  catch_copy_yahoo: z.string().default(""),
  // PC用販売説明文（楽天）。任意HTML。空なら画像枚数から imgList を自動生成する。
  sale_description_pc: z.string().default(""),
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

  // 画像 URL (1〜20)
  image_url_1: z.string().default(""),
  image_url_2: z.string().default(""),
  image_url_3: z.string().default(""),
  image_url_4: z.string().default(""),
  image_url_5: z.string().default(""),
  image_url_6: z.string().default(""),
  image_url_7: z.string().default(""),
  image_url_8: z.string().default(""),
  image_url_9: z.string().default(""),
  image_url_10: z.string().default(""),
  image_url_11: z.string().default(""),
  image_url_12: z.string().default(""),
  image_url_13: z.string().default(""),
  image_url_14: z.string().default(""),
  image_url_15: z.string().default(""),
  image_url_16: z.string().default(""),
  image_url_17: z.string().default(""),
  image_url_18: z.string().default(""),
  image_url_19: z.string().default(""),
  image_url_20: z.string().default(""),

  // 商品属性: 可変個数版（カテゴリIDからの自動補完で使用）。
  // 楽天ジャンルの推奨属性を item/value/unit の配列で保持する。空配列なら下記 1〜5 にフォールバック。
  attributes: z.array(AttributeSchema).default([]),

  // 商品属性 (1〜5) — 旧固定枠（後方互換。attributes が空のとき使われる）
  attribute_item_1: z.string().default(""),
  attribute_value_1: z.string().default(""),
  attribute_unit_1: z.string().default(""),
  attribute_item_2: z.string().default(""),
  attribute_value_2: z.string().default(""),
  attribute_unit_2: z.string().default(""),
  attribute_item_3: z.string().default(""),
  attribute_value_3: z.string().default(""),
  attribute_unit_3: z.string().default(""),
  attribute_item_4: z.string().default(""),
  attribute_value_4: z.string().default(""),
  attribute_unit_4: z.string().default(""),
  attribute_item_5: z.string().default(""),
  attribute_value_5: z.string().default(""),
  attribute_unit_5: z.string().default(""),
});

/** transform 適用版 (is_single/is_set 派生フィールドを追加) */
export const ProductInputSchema = ProductInputBaseSchema.transform((p) => ({
  ...p,
  is_single: p.product_type === "単品",
  is_set: p.product_type === "セット商品",
}));

export type ProductInput = z.infer<typeof ProductInputSchema>;
export type ProductInputBase = z.output<typeof ProductInputBaseSchema>;
export type Variant = z.output<typeof VariantSchema>;

/** 表示価格（二重価格）。display_price が正の値ならそれ、無ければ販売価格に連動。
 * CSV(楽天 表示価格 / Yahoo original-price)や反映で「表示価格＝販売価格」を基本にしつつ別値も許す。 */
export function displayPrice(p: { display_price?: number; selling_price: number }): number {
  return p.display_price && p.display_price > 0 ? p.display_price : p.selling_price;
}

/** 商品の SKU(variant) 一覧を統一的に取り出す。
 * variants[] が1件以上あればそれを、無ければフラットフィールドから単一SKUを1件合成する（後方互換）。
 * 全消費側(プレビュー/CSV/反映)はこのヘルパ経由で多SKU対応へ段階移行する。 */
export function productVariants(p: ProductInput): Variant[] {
  if (p.variants && p.variants.length > 0) return p.variants;
  return [
    VariantSchema.parse({
      sku_manage_number: p.rakuten_variant_id || p.ne_code,
      ne_code: p.ne_code,
      jan_code: p.jan_code,
      selling_price: p.selling_price,
      tax_rate: p.tax_rate,
      quantity: p.quantity,
      variation_value: "",
      shipping_type: p.shipping_type,
      attributes: p.attributes ?? [],
    }),
  ];
}

export type ResolvedAttribute = { item: string; value: string; unit: string };

/** 商品属性を統一的に取り出す。
 * attributes 配列があればそれを、無ければ旧 attribute_item_1〜5 から組み立てる。
 * onlyWithValue=true なら「値(value)が入っている項目だけ」を返す（CSV出力の絞り込み用）。 */
export function resolveAttributes(
  p: ProductInput,
  { onlyWithValue = false }: { onlyWithValue?: boolean } = {},
): ResolvedAttribute[] {
  let list: ResolvedAttribute[];
  if (p.attributes && p.attributes.length > 0) {
    list = p.attributes.map((a) => ({
      item: a.item ?? "",
      value: a.value ?? "",
      unit: a.unit ?? "",
    }));
  } else {
    list = [1, 2, 3, 4, 5].map((i) => ({
      item: (p[`attribute_item_${i}` as keyof ProductInput] as string) || "",
      value: (p[`attribute_value_${i}` as keyof ProductInput] as string) || "",
      unit: (p[`attribute_unit_${i}` as keyof ProductInput] as string) || "",
    }));
  }
  // 項目名が空の枠は常に除外
  list = list.filter((a) => a.item.trim() !== "");
  if (onlyWithValue) list = list.filter((a) => a.value.trim() !== "");
  return list;
}

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
