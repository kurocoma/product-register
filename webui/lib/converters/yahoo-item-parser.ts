import type { ProductInput } from "@/lib/product/schema";
import { yahooTaxExclusive, taxRateFromTaxrateType } from "./yahoo-tax";

/** <Tag><![CDATA[..]]></Tag> または <Tag>..</Tag> から値を取り出す。 */
function tagVal(xml: string, name: string): string {
  const cdata = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i"));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return plain ? plain[1] : "";
}

export type ParseYahooItemOptions = {
  /** XML に TaxrateType が無い場合に使う税率（%）。呼び出し側の product.tax_rate を渡す。既定 10。 */
  fallbackTaxRate?: number;
};

/** Yahoo getItem の XML から、編集対象になる項目を ProductInput 部分へパースする。
 * 構造は実機 getItem で確認済み（docs/Yahoo/03）。在庫(Quantity)はeditItem対象外のため参考程度。
 *
 * 価格の税意味: Yahoo の Price / OriginalPrice は税込。アプリの selling_price / display_price は
 * 全モール税抜統一のため、税抜へ変換して返す（送信側 yahooTaxInclusive と対称。lib/converters/yahoo-tax.ts）。
 * 税率は XML の TaxrateType（0.1/0.08）を優先し、無ければ opts.fallbackTaxRate（既定10）。
 * TaxrateType が取れた場合は tax_rate としても返し、送信時に同じ率で税込へ戻せるようにする。
 * Taxable=0（非課税）は税を含まないため変換しない。 */
export function parseYahooItem(xml: string, opts?: ParseYahooItemOptions): Partial<ProductInput> {
  const out: Partial<ProductInput> = {};
  const itemCode = tagVal(xml, "ItemCode");
  if (itemCode) out.ne_code = itemCode;
  const name = tagVal(xml, "Name");
  if (name) out.display_name = name;
  const cat = tagVal(xml, "ProductCategory");
  if (cat) out.yahoo_category_id = cat;

  // --- 価格（税込 → 税抜） ---
  const rateFromXml = taxRateFromTaxrateType(tagVal(xml, "TaxrateType"));
  if (rateFromXml !== undefined) out.tax_rate = rateFromXml;
  const rate = rateFromXml ?? opts?.fallbackTaxRate ?? 10;
  const nonTaxable = tagVal(xml, "Taxable") === "0"; // 0=非課税（税を含まない）
  const toExclusive = (n: number) => (nonTaxable ? n : yahooTaxExclusive(n, rate));
  const price = tagVal(xml, "Price");
  if (price) {
    out.selling_price = toExclusive(Number(price));
    // 表示価格(二重価格) ← OriginalPrice（同じく税抜へ）。販売価格と同額なら 0=販売価格連動 に正規化する
    // （register は display_price 未設定時に original-price=販売価格(税込) を送るため、
    //  そのまま取り込むと「連動」が「固定値」へ変わってしまうのを防ぐ）。
    const orig = tagVal(xml, "OriginalPrice");
    const display = orig ? toExclusive(Number(orig)) : 0;
    out.display_price = display === out.selling_price ? 0 : display;
  }

  const headline = tagVal(xml, "Headline");
  if (headline) out.catch_copy_yahoo = headline;
  const caption = tagVal(xml, "Caption");
  if (caption) out.description_pc = caption;
  const jan = tagVal(xml, "Jan");
  if (jan) out.jan_code = jan;
  // PathList > Path（CDATA）
  const path = (xml.match(/<Path[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Path>/i) || [])[1];
  if (path) out.yahoo_path = path;
  return out;
}
