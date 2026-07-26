import type { ProductInput } from "@/lib/product/schema";
import { displayPrice } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";
import { yahooTaxInclusive } from "./yahoo-tax";
import { buildYahooOptions, YahooConverter } from "./yahoo";

/** Yahoo editItem の form パラメータ。 */
export type YahooPatchParams = Record<string, string>;

/** CDATA or プレーンの単一タグ値を取り出す。 */
function tagVal(xml: string, name: string): string {
  const cdata = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i"));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return plain ? plain[1].trim() : "";
}

/** タグが「テキスト値 or 子要素」を持つ（＝実体がある）か。
 * フラット形式 <Spec1>x</Spec1> もコンテナ形式 <Spec1><SpecId>..</SpecId></Spec1> も検出する。 */
function hasContent(xml: string, name: string): boolean {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return !!m && m[1].trim() !== "";
}

/** getItem タグ → editItem パラメータ名（値はそのまま転記できるもの）。 */
const TAG_TO_PARAM: [getTag: string, param: string][] = [
  ["ItemCode", "item_code"],
  ["Name", "name"],
  ["ProductCategory", "product_category"],
  ["Price", "price"],
  ["OriginalPrice", "original_price"],
  ["SalePrice", "sale_price"],
  ["MemberPrice", "member_price"],
  ["OriginalPriceEvidence", "original_price_evidence"],
  ["Headline", "headline"],
  ["Caption", "caption"],
  ["Abstract", "abstract"],
  ["Explanation", "explanation"],
  ["Additional1", "additional1"],
  ["Additional2", "additional2"],
  ["Additional3", "additional3"],
  ["SpAdditional", "sp_additional"],
  ["MetaDesc", "meta_desc"],
  ["BrandCode", "brand_code"],
  ["ProductCode", "product_code"],
  ["Jan", "jan"],
  ["Condition", "condition"],
  ["IsDrug", "is_drug"],
  ["ItemTag", "item_tag"],
  ["Display", "display"],
  ["Delivery", "delivery"],
  ["Taxable", "taxable"],
  ["TaxrateType", "taxrate_type"],
  ["ShipWeight", "ship_weight"],
  ["PostageSet", "postage_set"],
  ["KeepStock", "keep_stock"],
  ["LeadTimeInStock", "lead_time_instock"],
  ["LeadTimeOutStock", "lead_time_outstock"],
  ["PointCode", "point_code"],
  ["PointImmediate", "point_immediate"],
  ["SpCode", "sp_code"],
  ["SaleLimit", "sale_limit"],
  ["ReleaseDate", "release_date"],
  ["SalePeriodStart", "sale_period_start"],
  ["SalePeriodEnd", "sale_period_end"],
  ["CartRelatedItems", "cart_related_items"],
  ["EcoSettingId", "eco_setting_id"],
  ["EcoSettingEvidenceUrl", "eco_setting_evidence_url"],
  // 定期購入5項目（260711修正依頼-Task7）。ここに載せないと、無関係な項目だけの更新
  // （editItem は未送信項目を既定値で上書きする）で既存の定期購入設定が消える（資料§9）。
  ["SubscriptionType", "subscription_type"],
  ["SubscriptionPrice", "subscription_price"],
  ["SubscriptionGroupIndex", "subscription_group_index"],
  ["SubscriptionRecommendedCycle", "subscription_recommended_cycle"],
  ["SubscriptionPointCode", "subscription_point_code"],
];

/** 定期購入の関連4項目（subscription_type 以外）。type=0 では送ってはならない。 */
const SUBSCRIPTION_RELATED_PARAMS = [
  "subscription_price",
  "subscription_group_index",
  "subscription_recommended_cycle",
  "subscription_point_code",
] as const;

/** PathList の Path(複数可・CDATA)を改行区切りで結合する。 */
function extractPath(xml: string): string {
  const list = xml.match(/<PathList>([\s\S]*?)<\/PathList>/i);
  const scope = list ? list[1] : xml;
  const paths = [...scope.matchAll(/<Path[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Path>/gi)].map((m) => m[1]);
  return paths.join("\n");
}

/** Image(メイン) + LibImage1..20 を ; 区切りに（空はスキップ）。 */
function extractImages(xml: string): string {
  const urls: string[] = [];
  const main = tagVal(xml, "Image");
  if (main) urls.push(main);
  for (let i = 1; i <= 20; i++) {
    const v = tagVal(xml, `LibImage${i}`);
    if (v) urls.push(v);
  }
  return urls.join(";");
}

/** コンテナタグ（<Spec1>..</Spec1> 等）の内側 XML を返す（無ければ ""）。
 * tagVal は文書全体を検索するため、Variation1/Name が商品名 Name と衝突しないよう
 * 子要素の抽出は必ずこのスコープ内で行う。 */
function containerContent(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

/** spec1-10 / grouping_id / variation1-5 を getItem XML から editItem パラメータへ転記する
 * （260712修正依頼-3）。editItem は未送信項目を削除/既定値上書きするため、転記しないと
 * 無関係な更新のたびにストア側設定が消える。転記フォーマットは editItem.html で確認:
 *  - specN = "{SpecId}:{SpecValue}"（項目と値をコロン区切り）
 *  - variationN_spec_id / variationN_name / variationN_free_title
 *  - grouping_id */
function extractAdvancedParams(xml: string, params: YahooPatchParams): void {
  for (let i = 1; i <= 10; i++) {
    const c = containerContent(xml, `Spec${i}`);
    if (!c.trim()) continue;
    const id = tagVal(c, "SpecId");
    const value = tagVal(c, "SpecValue");
    if (id && value) params[`spec${i}`] = `${id}:${value}`;
  }
  for (let i = 1; i <= 5; i++) {
    const c = containerContent(xml, `Variation${i}`);
    if (!c.trim()) continue;
    const specId = tagVal(c, "SpecID");
    const name = tagVal(c, "Name");
    const freeTitle = tagVal(c, "FreeTitle");
    if (specId) params[`variation${i}_spec_id`] = specId;
    if (name) params[`variation${i}_name`] = name;
    if (freeTitle) params[`variation${i}_free_title`] = freeTitle;
  }
  const grouping = tagVal(xml, "GroupingId");
  if (grouping) params.grouping_id = grouping;
}

/** getItem の <Options> を editItem `options` 文字列（name#v1,v2|name2#...）へ転記する（260723・51商品実件）。
 * 実測で確認できた単純形（type="2"・スペック連携なし・有料/選択不可なし・自己終了 Value）だけを変換し、
 * それ以外の形は null を返して従来どおり advanced ブロックに委ねる（安全側）。
 * 書式と使用不可文字（半角 <>;:&=#"\ と半角スペース）は editItem.html / docs/Yahoo/04 に従う。
 * 戻り値: "" = Options 実体なし（転記不要） / 文字列 = 転記値 / null = 未対応形（ブロック継続）。 */
function serializeOptionsFromXml(xml: string): string | null {
  const container = xml.match(/<Options>([\s\S]*?)<\/Options>/i);
  if (!container) return "";
  const attr = (s: string, name: string) => s.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "";
  const FORBIDDEN = /[#|,;:=<>&"\\ ]/; // 区切り記号・Yahoo使用不可の半角記号・半角スペース
  const parts: string[] = [];
  for (const m of container[1].matchAll(/<Option\b([^>]*)>([\s\S]*?)<\/Option>/gi)) {
    const [, attrs, inner] = m;
    if (attr(attrs, "type") !== "2") return null; // 実測はすべて type="2"。他typeは意味未確認のため転記しない
    if (attr(attrs, "specId") !== "") return null; // スペック連携は未検証
    const name = attr(attrs, "name");
    if (!name || FORBIDDEN.test(name)) return null;
    const values: string[] = [];
    for (const vm of inner.matchAll(/<Value\b([^>]*?)\/>/gi)) {
      const va = vm[1];
      if (attr(va, "unselectableFlag") === "1") return null; // 選択不可(=接頭)は未検証
      if (attr(va, "option_charge") !== "") return null; // 有料オプションは未検証
      if (attr(va, "specValue") !== "") return null;
      const vname = attr(va, "name");
      if (!vname || FORBIDDEN.test(vname)) return null;
      values.push(vname);
    }
    if (values.length === 0) return null;
    parts.push(`${name}#${values.join(",")}`);
  }
  if (parts.length === 0) return ""; // <Options> はあるが Option 実体なし
  return parts.join("|");
}

/** editItem で安全に転記できない高度な設定が「実体として存在する」かを検出する。
 * 存在する場合はラウンドトリップで失われる恐れがあるため、呼び出し側で警告/中止する。
 * spec / grouping / variation は extractAdvancedParams で転記できた場合のみ検出から外す
 * （実体があるのに転記できなかった＝想定外の形は、従来どおり安全側でブロック）。 */
function detectAdvanced(xml: string, transcribed: YahooPatchParams): string[] {
  const adv: string[] = [];
  for (let i = 1; i <= 10; i++) {
    if (hasContent(xml, `Spec${i}`) && !transcribed[`spec${i}`]) { adv.push("spec"); break; }
  }
  if (hasContent(xml, "GroupingId") && !transcribed.grouping_id) adv.push("grouping");
  for (let i = 1; i <= 5; i++) {
    const done = transcribed[`variation${i}_spec_id`] || transcribed[`variation${i}_name`] || transcribed[`variation${i}_free_title`];
    if (hasContent(xml, `Variation${i}`) && !done) { adv.push("variation"); break; }
  }
  // options は単純形（type=2・スペック/有料/選択不可なし）のみ serializeOptionsFromXml で転記できる。
  // 転記できなかった（未対応形）場合のみ従来どおりブロック。subcodes 等は引き続きブロック
  // （subcode_images の JSON 書式が別マニュアルのため）。
  if (/<Options>[\s\S]*?<Option[ >]/i.test(xml) && !transcribed.options) adv.push("options");
  if (/<SubCodes>[\s\S]*?<SubCode[ >]/i.test(xml)) adv.push("subcodes");
  if (/<Inscriptions>[\s\S]*?<Inscription[ >]/i.test(xml)) adv.push("inscriptions");
  // subscription は TAG_TO_PARAM の5項目でラウンドトリップ可能になったため advanced 扱いしない
  // （260711修正依頼-Task7。inscription 等の未対応項目は引き続き上で検出＝409中止の対象）。
  // ReservePrices コンテナ内のいずれかの予約値に実体があれば検出（空の入れ子のみは除外）。
  const rp = xml.match(/<ReservePrices>([\s\S]*?)<\/ReservePrices>/i);
  if (rp && /<(ReservePrice|ReserveSalePrice|ReserveMemberPrice|ReserveSellingPeriodStart|ReserveSellingPeriodEnd)>\s*[^<\s]/i.test(rp[1])) {
    adv.push("reserve");
  }
  return [...new Set(adv)];
}

/** getItem の生XML → editItem パラメータ（現在値を完全復元）。
 * Yahoo は「送らない項目を既定値で上書き」するため、部分更新でも全項目を再送する必要がある。
 * 空値のタグは送らない（既に空＝既定のため、明示送信は不要）。 */
export function xmlToEditItemParams(
  xml: string,
  sellerId: string,
): { params: YahooPatchParams; advanced: string[] } {
  const params: YahooPatchParams = { seller_id: sellerId };
  for (const [tag, param] of TAG_TO_PARAM) {
    const v = tagVal(xml, tag);
    if (v !== "") params[param] = v;
  }
  const path = extractPath(xml);
  if (path) params.path = path;
  const imgs = extractImages(xml);
  if (imgs) params.item_image_urls = imgs;
  // 定期購入: getItem が type=0 なのに関連タグの残骸を返しても転記しない
  // （type=0 で関連4項目を送ると it-14107/14110/14123。資料§5）。
  if ((params.subscription_type ?? "0") === "0") {
    for (const k of SUBSCRIPTION_RELATED_PARAMS) delete params[k];
  }
  extractAdvancedParams(xml, params);
  // 商品オプションの転記（保持）。null=未対応形は params に載せず detectAdvanced のブロックに委ねる。
  const options = serializeOptionsFromXml(xml);
  if (options) params.options = options;
  return { params, advanced: detectAdvanced(xml, params) };
}

/** 変更フィールド → editItem パラメータの上書きマップ。
 * 価格: アプリの selling_price / display_price は税抜（全モール統一）、Yahoo の price / original_price は
 * 税込のため、送信時に税込へ変換する（取込側 parseYahooItem の税抜変換と対称。lib/converters/yahoo-tax.ts）。 */
const OVERRIDE: Record<string, { param: string; get: (p: ProductInput) => string }> = {
  display_name: { param: "name", get: (p) => p.display_name },
  selling_price: { param: "price", get: (p) => String(yahooTaxInclusive(p.selling_price, p.tax_rate)) },
  display_price: { param: "original_price", get: (p) => String(yahooTaxInclusive(displayPrice(p), p.tax_rate)) },
  yahoo_category_id: { param: "product_category", get: (p) => p.yahoo_category_id },
  yahoo_path: { param: "path", get: (p) => p.yahoo_path },
  catch_copy_yahoo: { param: "headline", get: (p) => p.catch_copy_yahoo },
  description_pc: { param: "caption", get: (p) => p.description_pc },
  jan_code: { param: "jan", get: (p) => p.jan_code },
  // 定期購入5項目（260711修正依頼-Task7）。subscription_price はアプリ内税抜 → 通常価格と同じ
  // 税込変換で送信（取込側 parseYahooItem の税抜変換と対称）。0/空 = 未設定は空文字を返し、
  // buildYahooUpdateParams の最終整合でパラメータごと削除する（空文字送信での既定値上書きを避ける）。
  yahoo_subscription_type: { param: "subscription_type", get: (p) => String(p.yahoo_subscription_type) },
  yahoo_subscription_price: {
    param: "subscription_price",
    get: (p) => (p.yahoo_subscription_price > 0 ? String(yahooTaxInclusive(p.yahoo_subscription_price, p.tax_rate)) : ""),
  },
  yahoo_subscription_group_index: {
    param: "subscription_group_index",
    get: (p) => (p.yahoo_subscription_group_index > 0 ? String(p.yahoo_subscription_group_index) : ""),
  },
  yahoo_subscription_recommended_cycle: {
    param: "subscription_recommended_cycle",
    get: (p) => p.yahoo_subscription_recommended_cycle,
  },
  yahoo_subscription_point_code: {
    param: "subscription_point_code",
    get: (p) => (p.yahoo_subscription_point_code > 0 ? String(p.yahoo_subscription_point_code) : ""),
  },
};

/** 多SKUページの商品を「この Yahoo 商品コード(= ne_code)の1商品」として扱えるよう、
 * 自SKUを先頭（YahooConverter の代表行）に据えた商品を返す。
 * YahooConverter は CSV/登録と共通で variants[0] を代表にするため、そのまま渡すと
 * caption の画像一覧（imgList は代表SKUの商品コードで組み立てる）や送料アイコンが
 * 別SKUの値になる（260726実件: r124 の商品コードは r124-3 なのに caption が r124-1 の画像を指していた）。
 * 単一SKU・自SKUが見つからない場合は何もしない（従来動作）。 */
function withOwnVariantFirst(p: ProductInput): ProductInput {
  const vs = p.variants ?? [];
  if (vs.length <= 1) return p;
  const i = vs.findIndex((v) => String(v.ne_code ?? "").trim() === String(p.ne_code ?? "").trim());
  if (i <= 0) return p;
  return { ...p, variants: [vs[i], ...vs.slice(0, i), ...vs.slice(i + 1)] };
}

/** 現在の getItem XML を土台に、変更フィールドだけ上書きした editItem パラメータを作る（ラウンドトリップ更新）。
 * display は現在値を維持（XML から復元済み）し、誤公開を防ぐ。
 * editItem で扱えない変更（画像差し替え・在庫など）は skipped に積み、別フローへ委ねる。 */
export function buildYahooUpdateParams(
  currentXml: string,
  changed: ChangedField[],
  p: ProductInput,
  opts: { sellerId: string },
): { params: YahooPatchParams; advanced: string[]; skipped: string[] } {
  const { params, advanced } = xmlToEditItemParams(currentXml, opts.sellerId);
  // 商品オプション: アプリDB(customization_options)が非空なら DB を正として送る（削除・改名を反映。260723裁定）。
  // Yahoo側が未対応形（advanced に options）なら上書きせず従来どおりブロック。DBが空の場合は
  // ラウンドトリップ値を維持し、暗黙のオプション全消しはしない（安全側）。
  if (!advanced.includes("options") && (p.customization_options ?? []).length > 0) {
    const fromDb = buildYahooOptions(p.customization_options);
    if (fromDb) params.options = fromDb;
  }
  const REQUIRED = new Set(["name", "price", "product_category", "path"]);
  const skipped: string[] = [];
  for (const c of changed) {
    const o = OVERRIDE[c.field];
    if (!o) { skipped.push(c.field); continue; }
    const v = o.get(p);
    // 必須項目を空で送ると既定化/エラーになるため、空なら土台(現在値)を維持。
    if (REQUIRED.has(o.param) && v === "") { skipped.push(c.field); continue; }
    params[o.param] = v;
    // 商品説明(caption)は register 同様 SP用フリースペースとも同値にする（PC/SP不整合を防ぐ）。
    if (c.field === "description_pc") params.sp_additional = v;
    // 通常購入販売価格(price)を変えたら表示価格(original_price)も連動させる（display_price優先、無ければ販売価格）。
    // original_price も Yahoo は税込のため税込へ変換して送る。
    if (c.field === "selling_price") params.original_price = String(yahooTaxInclusive(displayPrice(p), p.tax_rate));
  }
  // アプリ管理項目はビルダー（CSV/register と同一ロジック）の値で常に上書きする（260724・r8901-1実件）。
  // - caption / sp_additional: imgList（Yahoo lib画像の一覧HTML）+ 説明文。素の description_pc を
  //   送ると imgList が消えるため、変更有無に関わらずビルダー値を正とする。
  // - ship_weight / delivery: 送料無料=100/1（送料無料アイコン）。DB の shipping_type を正とする。
  // - subscription 5項目: DB の type が 1/2 のときだけ DB を正として送る。type=0 は「未管理」であり
  //   Yahoo 側の既存定期設定をラウンドトリップで保持する（criteria C1・yahoo-subscription-patch.test.ts。
  //   明示的な無効化は register 経路= buildYahooEditItemParams の役割）。
  {
    const row = new YahooConverter().convert([withOwnVariantFirst(p)])[0];
    if (row["caption"]) {
      params.caption = row["caption"];
      params.sp_additional = row["sp-additional"] || row["caption"];
    }
    params.ship_weight = row["ship-weight"];
    params.delivery = row["delivery"];
    if (p.yahoo_subscription_type === 1 || p.yahoo_subscription_type === 2) {
      params.subscription_type = row["subscription-type"];
      params.subscription_price = row["subscription-price"];
      params.subscription_group_index = row["subscription-group-index"];
      params.subscription_recommended_cycle = row["subscription-recommended-cycle"];
      params.subscription_point_code = row["subscription-point-code"];
    }
  }

  // 定期購入の送信値の最終整合（260711修正依頼-Task7。資料§5）:
  // - OVERRIDE が空文字を積んだ任意項目（cycle 未設定・point/group/price 0=未設定）は
  //   パラメータごと削除する（空文字で送ると既定値上書き/書式エラーになる）
  // - type を 0 へ変える更新では関連4項目を必ず削除する（土台のラウンドトリップ値が
  //   残ると it-14107/14110/14123 になる）
  for (const k of SUBSCRIPTION_RELATED_PARAMS) {
    if (params[k] === "") delete params[k];
  }
  if (params.subscription_type === "0") {
    for (const k of SUBSCRIPTION_RELATED_PARAMS) delete params[k];
  }
  return { params, advanced, skipped };
}
