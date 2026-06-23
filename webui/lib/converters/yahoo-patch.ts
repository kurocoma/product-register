import type { ProductInput } from "@/lib/product/schema";
import type { ChangedField } from "@/lib/product/diff";

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
];

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

/** editItem で安全に転記できない高度な設定が「実体として存在する」かを検出する。
 * 存在する場合はラウンドトリップで失われる恐れがあるため、呼び出し側で警告/中止する。 */
function detectAdvanced(xml: string): string[] {
  const adv: string[] = [];
  for (let i = 1; i <= 10; i++) if (hasContent(xml, `Spec${i}`)) { adv.push("spec"); break; }
  if (hasContent(xml, "GroupingId")) adv.push("grouping");
  for (let i = 1; i <= 5; i++) if (hasContent(xml, `Variation${i}`)) { adv.push("variation"); break; }
  if (/<Options>[\s\S]*?<Option[ >]/i.test(xml)) adv.push("options");
  if (/<SubCodes>[\s\S]*?<SubCode[ >]/i.test(xml)) adv.push("subcodes");
  if (/<Inscriptions>[\s\S]*?<Inscription[ >]/i.test(xml)) adv.push("inscriptions");
  const st = tagVal(xml, "SubscriptionType");
  if (st && st !== "0") adv.push("subscription");
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
  return { params, advanced: detectAdvanced(xml) };
}

/** 変更フィールド → editItem パラメータの上書きマップ。 */
const OVERRIDE: Record<string, { param: string; get: (p: ProductInput) => string }> = {
  display_name: { param: "name", get: (p) => p.display_name },
  selling_price: { param: "price", get: (p) => String(p.selling_price) },
  yahoo_category_id: { param: "product_category", get: (p) => p.yahoo_category_id },
  yahoo_path: { param: "path", get: (p) => p.yahoo_path },
  catch_copy_yahoo: { param: "headline", get: (p) => p.catch_copy_yahoo },
  description_pc: { param: "caption", get: (p) => p.description_pc },
  jan_code: { param: "jan", get: (p) => p.jan_code },
};

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
  }
  return { params, advanced, skipped };
}
