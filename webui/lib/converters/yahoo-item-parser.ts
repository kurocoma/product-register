import type { ProductInput } from "@/lib/product/schema";

/** <Tag><![CDATA[..]]></Tag> または <Tag>..</Tag> から値を取り出す。 */
function tagVal(xml: string, name: string): string {
  const cdata = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, "i"));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return plain ? plain[1] : "";
}

/** Yahoo getItem の XML から、編集対象になる項目を ProductInput 部分へパースする。
 * 構造は実機 getItem で確認済み（docs/Yahoo/03）。在庫(Quantity)はeditItem対象外のため参考程度。 */
export function parseYahooItem(xml: string): Partial<ProductInput> {
  const out: Partial<ProductInput> = {};
  const itemCode = tagVal(xml, "ItemCode");
  if (itemCode) out.ne_code = itemCode;
  const name = tagVal(xml, "Name");
  if (name) out.display_name = name;
  const cat = tagVal(xml, "ProductCategory");
  if (cat) out.yahoo_category_id = cat;
  const price = tagVal(xml, "Price");
  if (price) out.selling_price = Number(price);
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
