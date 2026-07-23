import { z } from "zod";

/** 商品属性(ジャンル必須属性等)の1項目。product共通・variant単位の双方で使う。 */
export const AttributeSchema = z.object({
  item: z.string().default(""),
  value: z.string().default(""),
  unit: z.string().default(""),
  requirement: z.string().default(""), // 必須/いずれか必須/任意（UI強調用。CSV出力には影響しない）
});

/** 楽天SKUの属性情報自由入力行（variants[].specs[]）。
 * Item API / RMS CSV の制約をスキーマ境界で保証する。 */
export const VariantSpecSchema = z
  .object({
    label: z.string().min(1).max(40),
    value: z.string().min(1).max(140),
  })
  .strict();

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
  // 楽天在庫数（InventoryAPI で登録時に送る値。260720仕様変更）。
  // undefined=未入力: 既存商品は在庫を変更しない／新規は安全登録の0。0 は「意図的なゼロ」。
  stock_quantity: z.number().int().min(0).optional(),
  // SKU管理画像（楽天 variants.{}.images、SKUごとに0〜1枚）。R-Cabinet の公開画像URLを保持し、
  // 反映時に rakuten-api.ts が "/画像パス"(location) へ変換して同梱する。
  // 未設定/空 = SKU画像なし。optional = 既存variant互換（display_price と同じ理由）。
  image_url: z.string().optional(),
  // お届けの目安 = 在庫あり時納期管理番号（楽天 variant.normalDeliveryDateId、SKU単位）。
  // 楽天の納期マスタID を文字列で保持（空/未設定 = 送らない）。260715: SKU項目整合。
  // optional = 既存variant互換（display_price / image_url と同じ理由）。
  normal_delivery_date_id: z.string().optional(),
  // 配送(SKU別、#3)。楽天 variant.shipping へマッピングする。
  shipping_type: z.string().default("送料別"),     // 送料無料/別 → postageIncluded
  postage_segment_1: z.string().default(""),       // 送料区分1(postageSegment.local)
  postage_segment_2: z.string().default(""),       // 送料区分2(postageSegment.overseas)
  shipping_method_group: z.string().default(""),   // 配送方法セットID(shippingMethodGroup)
  individual_shipping_fee: z.string().default(""), // 個別送料(shipping.fee)
  okihai: z.boolean().default(true),               // 置き配 受付
  attributes: z.array(AttributeSchema).default([]),
  // 楽天の属性情報自由入力行（RMS CSV「自由入力行（項目/値）1..5」）。
  // optional は既存保存データとの互換用。undefined=未管理（patchは現行値を保持、既存商品の
  // upsertはregister serviceがitems.get snapshotから補完）、[]=明示的に全行削除、1..5件=編集値を反映する。
  specs: z.array(VariantSpecSchema).max(5).optional(),
  // 定期購入価格（260711修正依頼-5。楽天 variant.subscriptionPrice）。未設定/0 = このSKUは通常購入のみ。
  // optional = 既存variant互換（display_price と同じ理由）。
  subscription_base_price: z.number().int().min(0).optional(),  // subscriptionPrice.basePrice（税抜）
  subscription_first_price: z.number().int().min(0).optional(), // subscriptionPrice.individualPrices.firstPrice（税抜）
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
  // モール掲載状況（反映ボタンの活性判定に使う）。取込/登録/反映成功で各モールを true にする。
  // 楽天は rakuten_manage_number があれば掲載とみなす（後方互換のフォールバック）。
  mall_listed: z.object({ rakuten: z.boolean().optional(), yahoo: z.boolean().optional(), shopify: z.boolean().optional() }).default({}),
  // モール識別子: 取込商品の実際の楽天 商品管理番号。
  // 非規約書式(maker-JAN下4桁以外)でも編集→反映で同一商品へ往復させるため保存する。
  // 空のとき buildRakutenManageNumber は従来どおり baseCodeOf を使う（新規登録・既存商品は後方互換）。
  rakuten_manage_number: z.string().default(""),
  // 楽天 variant キー(SKU管理番号)。NEコード(=merchantDefinedSkuId)と別物の外部作成商品で、
  // upsert/patch の variants.{key} に使う実キーを保持する。空のとき ne_code を使う（後方互換）。
  rakuten_variant_id: z.string().default(""),
  // モール識別子: Shopify 商品の Global ID（gid://shopify/Product/{数値}）。
  // 取込・編集→反映で同一商品へ往復させる冪等キー（rakuten_manage_number と同じ位置づけ）。
  shopify_product_id: z.string().default(""),

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
  // Yahoo 向け手動リライトの恒久化（migrate の文字数オーバー書き換え）。
  // extra JSONB に往復し、migrate 再実行時に自動適用する（リクエストの override が最優先）。
  // name→display_name / headline→catch_copy_yahoo / explanation→free1 に適用する。
  yahoo_rewrite: z
    .object({
      name: z.string().optional(),
      headline: z.string().optional(),
      explanation: z.string().optional(),
    })
    .default({}),

  // Shopify 固有項目（アプリに対応列が無い status / 商品タイプ / SEO）の編集値。
  // extra JSONB に往復し（yahoo_rewrite と同じ持ち方）、設定されている項目だけを
  // shopify-patch が productUpdate の差分計画へ載せる。未設定 = Shopify 現状を保持。
  shopify_overrides: z
    .object({
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
      product_type: z.string().optional(),
      seo_title: z.string().optional(),
      seo_description: z.string().optional(),
    })
    .default({}),

  // バリエーション
  option_item_name: z.string().default(""),
  option_horizontal: z.string().default(""),
  variation_key: z.string().default(""),
  variation_name: z.string().default(""),
  variation_choices: z.string().default(""),
  choice_numbers: z.string().default(""),
  // Yahoo へのバリエーション商品の登録方式（260711修正依頼-7）。
  // split = SKUごとに別商品へ分割（従来既定） / unified = 1商品に統合し options+sub-code で登録
  yahoo_variation_mode: z.enum(["split", "unified"]).default("split"),

  // 定期購入（260711修正依頼-5。楽天 ItemAPI 2.0 subscription/features — 定期専用 itemType は無い）
  subscription_enabled: z.boolean().default(false),             // features.displaySubscriptionCartButton
  subscription_shipping_date_flag: z.boolean().default(false),  // subscription.shippingDateFlag（お届け日付指定可）
  subscription_interval_flag: z.boolean().default(false),       // subscription.shippingIntervalFlag（お届け間隔指定可）
  // フラット商品（variants 未設定）用の定期価格。多SKU商品は variants[].subscription_base_price を使う。
  subscription_base_price: z.number().int().min(0).default(0),
  subscription_first_price: z.number().int().min(0).default(0),

  // フラット商品（variants 未設定）用の楽天在庫数。多SKU商品は variants[].stock_quantity を使う。
  // undefined=未入力（既存商品の在庫を変更しない）。260720仕様変更。
  stock_quantity: z.number().int().min(0).optional(),

  // 定期購入 — Yahoo!ショッピング（260711修正依頼-Task7。editItem の subscription_* 5項目）。
  // 楽天用（上の subscription_*）とは意味が異なるため別フィールドで保持する:
  // Yahoo には type=2「定期購入のみ」があり、group/cycle は楽天の日付/間隔フラグと非対応、
  // 楽天はSKU別定期価格・Yahooは商品レベル1価格（資料 yahoo-subscription-product-registration.md §9）。
  yahoo_subscription_type: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0), // 0=設定なし / 1=通常+定期 / 2=定期のみ
  yahoo_subscription_price: z.number().int().min(0).default(0), // 定期購入価格（アプリ内は税抜。0=未設定。type1/2で必須）
  yahoo_subscription_group_index: z.number().int().min(0).default(0), // 定期購入グループ管理番号（1〜20。0=未設定。type1/2で必須）
  yahoo_subscription_recommended_cycle: z.string().default(""), // おすすめサイクル（"0"/"1:日数10〜90"/"2:月数1〜6"。空=未設定）
  yahoo_subscription_point_code: z.number().int().min(0).default(0), // 定期購入ポイント倍率（1〜15。0=未設定=APIへ送らない）

  // 白背景画像URL（楽天 whiteBgImage、商品全体で1枚。SKU単位ではない）。
  // 「画像アップロード」パネルの白背景(wb01)アップロード結果（公開URL）を保持し、
  // 反映時に rakuten-api.ts が "/画像パス"(location) へ変換して whiteBgImage に載せる。空 = 未設定。
  white_bg_image_url: z.string().default(""),

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

  // 商品オプション（項目選択肢）。楽天 customizationOptions → Yahoo options(自由文形式) 用。
  // 各オプションは { name: 項目名, values: 選択肢[] }。永続化は extra JSONB へ。
  customization_options: z
    .array(z.object({ name: z.string(), values: z.array(z.string()) }))
    .default([]),
  // 商品オプションの忠実性メタ（260720）。取込時に全オプション（自由入力 FREE_TEXT 含む）の
  // 種別・必須フラグを保持し、登録（upsert 全置換）で楽天へ劣化なく送り返すために使う。
  // customization_options（選択肢ありのみ・編集用）とは name で対応付ける。
  customization_options_meta: z
    .array(z.object({ name: z.string(), input_type: z.string().default("SINGLE_SELECTION"), required: z.boolean().default(false) }))
    .default([]),
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

/** モール掲載状況。mall_listed を優先し、楽天は rakuten_manage_number・Shopify は
 * shopify_product_id があれば掲載とみなす（後方互換）。
 * 反映ボタンの活性判定に使う（掲載モールだけ有効化）。 */
export function mallPresence(p: {
  mall_listed?: { rakuten?: boolean; yahoo?: boolean; shopify?: boolean };
  rakuten_manage_number?: string;
  shopify_product_id?: string;
}): { rakuten: boolean; yahoo: boolean; shopify: boolean } {
  const ml = p.mall_listed ?? {};
  return {
    rakuten: !!ml.rakuten || !!(p.rakuten_manage_number && String(p.rakuten_manage_number).trim()),
    yahoo: !!ml.yahoo,
    shopify: !!ml.shopify || !!(p.shopify_product_id && String(p.shopify_product_id).trim()),
  };
}

/** 表示価格（二重価格）。display_price が正の値ならそれ、無ければ販売価格に連動。
 * CSV(楽天 表示価格 / Yahoo original-price)や反映で「表示価格＝販売価格」を基本にしつつ別値も許す。 */
export function displayPrice(p: { display_price?: number; selling_price: number }): number {
  return p.display_price && p.display_price > 0 ? p.display_price : p.selling_price;
}

/** 商品の SKU(variant) 一覧を統一的に取り出す。
 * variants[] が1件以上あればそれを、無ければフラットフィールドから単一SKUを1件合成する（後方互換）。
 * 全消費側(プレビュー/CSV/反映)はこのヘルパ経由で多SKU対応へ段階移行する。 */
/** 実質空の variant（「+ SKU追加」の空行が保存されたゴーストSKU）か。
 * 識別子・ラベル・価格・定期価格・属性・配送指定のどれも持たない行を「空」とみなす。
 * 空行が1件でも保存されると多SKU扱いに切り替わり、商品レベルの定期購入価格が
 * 無視される等の事故（IE0433・r0101-1 実件）が起きるため、判定を一箇所に持つ。 */
export function isEmptyVariant(v: Variant): boolean {
  const texts = [
    v.sku_manage_number, v.ne_code, v.jan_code, v.variation_value, v.image_url,
    v.postage_segment_1, v.postage_segment_2, v.shipping_method_group,
    v.normal_delivery_date_id, v.individual_shipping_fee,
  ];
  if (texts.some((s) => String(s ?? "").trim() !== "")) return false;
  const nums = [v.selling_price, v.display_price, v.subscription_base_price, v.subscription_first_price, v.stock_quantity];
  if (nums.some((n) => (n ?? 0) > 0)) return false;
  if ((v.attributes ?? []).length > 0) return false;
  if ((v.specs ?? []).length > 0) return false;
  return true;
}

/** 実質空の variant 行だけを除去する（実内容のある行はそのまま）。 */
export function pruneEmptyVariants(list: Variant[]): Variant[] {
  return list.filter((v) => !isEmptyVariant(v));
}

export function productVariants(p: ProductInput): Variant[] {
  // ゴーストSKU（実質空の行）は無視する。全部空ならフラット合成へフォールバック。
  const real = pruneEmptyVariants(p.variants ?? []);
  if (real.length > 0) return real;
  return [
    VariantSchema.parse({
      sku_manage_number: p.rakuten_variant_id || p.ne_code,
      ne_code: p.ne_code,
      jan_code: p.jan_code,
      selling_price: p.selling_price,
      // 表示価格（二重価格）。単品は商品レベルの display_price を引き継ぐ（0=未設定は送信側で除外）。
      display_price: p.display_price,
      tax_rate: p.tax_rate,
      quantity: p.quantity,
      variation_value: "",
      shipping_type: p.shipping_type,
      attributes: p.attributes ?? [],
      subscription_base_price: p.subscription_base_price,
      subscription_first_price: p.subscription_first_price,
      stock_quantity: p.stock_quantity,
    }),
  ];
}

/** SKU(variant) の表示価格（二重価格）。variant.display_price 優先。
 * フラット商品(variants未設定)は product の二重価格に従来どおり連動し、
 * 実 variants を持つ商品で未設定なら販売価格に連動する。CSV/プレビューの共通規則。 */
export function variantDisplayPrice(p: ProductInput, v: Variant): number {
  if (v.display_price && v.display_price > 0) return v.display_price;
  return p.variants.length === 0 ? displayPrice(p) : v.selling_price;
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
