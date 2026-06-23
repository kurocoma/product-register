import type { ProductInput } from "@/lib/product/schema";
import type { Converter } from "./base";
import { ENCODING } from "./base";
import { RAKUTEN_IMAGE_BASE } from "./image-url";

function extractSireCode(makerCode: string): string {
  return makerCode.replace(/[^0-9]/g, "");
}

function stripTrailingSuffix(neCode: string): string {
  return neCode.replace(/-\d+$/, "");
}

function singleCodeFromSetCode(neCode: string): string {
  return neCode.replace(/-\d+$/, "-1");
}

function buildImgListHtml(neCode: string, imageCount: number): string {
  if (imageCount <= 1) return "";
  const imgs = Array.from({ length: imageCount - 1 }, (_, i) =>
    `<img src="${RAKUTEN_IMAGE_BASE}/${neCode}_${i + 2}.jpg" width="100%"><br>`,
  ).join("");
  return `<!--imgList-->${imgs}<!--/imgList-->`;
}

function buildGazouUrlsSingle(
  neCode: string,
  imageCount: number,
  imageUrl20: string,
): Record<string, string> {
  const baseCode = stripTrailingSuffix(neCode);
  const result: Record<string, string> = {};
  for (let i = 1; i <= 20; i++) result[`gazou_url${i}`] = "";
  result["gazou_url1"] = `${RAKUTEN_IMAGE_BASE}/${neCode}.jpg`;
  for (let i = 2; i <= imageCount; i++) {
    result[`gazou_url${i}`] = `${RAKUTEN_IMAGE_BASE}/${baseCode}_${i}.jpg`;
  }
  if (imageUrl20) result["gazou_url20"] = imageUrl20;
  return result;
}

function buildGazouUrlsSet(
  neCode: string,
  imageCount: number,
  imageUrl20: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 1; i <= 20; i++) result[`gazou_url${i}`] = "";
  result["gazou_url1"] = `${RAKUTEN_IMAGE_BASE}/${neCode}.jpg`;
  for (let i = 2; i <= imageCount; i++) {
    result[`gazou_url${i}`] = `${RAKUTEN_IMAGE_BASE}/${neCode}_${i}.jpg`;
  }
  if (imageUrl20) result["gazou_url20"] = imageUrl20;
  return result;
}

function soryoKbn(shippingType: string): string {
  return shippingType === "送料無料" ? "2" : "1";
}

export class NEConverter implements Converter {
  mallName = "ne" as const;
  encoding = ENCODING.ne;

  convert(products: ProductInput[]): { singles: Record<string, string>[]; sets: Record<string, string>[] } {
    const singles: Record<string, string>[] = [];
    const sets: Record<string, string>[] = [];
    for (const p of products) {
      if (p.is_single) singles.push(this.mapSingle(p));
      else sets.push(this.mapSet(p));
    }
    return { singles, sets };
  }

  private mapSingle(p: ProductInput): Record<string, string> {
    const imageUrl = p.image_url_1 || `${RAKUTEN_IMAGE_BASE}/${p.ne_code}.jpg`;
    const imgList = buildImgListHtml(p.ne_code, p.image_count);
    const setumei2 = imgList ? `${imgList}\n${p.description_pc}` : p.description_pc;
    const gazou = buildGazouUrlsSingle(p.ne_code, p.image_count, p.image_url_20);
    const taxInclusive = Math.floor(p.selling_price * (1 + p.tax_rate / 100));

    return {
      syohin_code: p.ne_code,
      sire_code: extractSireCode(p.maker_code),
      syohin_name: p.product_name,
      baika_tnk: String(p.selling_price),
      tax_rate: String(p.tax_rate),
      toriatukai_kbn: "0",
      genka_tnk: String(p.cost_price),
      jan_code: p.jan_code,
      daihyo_syohin_code: "",
      image_url_http: imageUrl,
      hyoji_tnk: "",
      zei_kbn: "0",
      package_haba: "",
      package_okuyuki: "",
      package_takasa: "",
      package_omosa: "",
      hasou_kikan_kbn: "",
      size: "",
      gift_ok_flg: "",
      noshi_kbn: "",
      iro: "",
      brand_name: p.brand_name,
      maker_kataban: "",
      maker_name: p.maker_name,
      hanbai_kaisi_bi: "",
      hanbai_syuryo_bi: "",
      kataban: "",
      location: "",
      syohin_jyotai_kbn: "",
      syohin_jyotai_setumei: "",
      page_syohin_name: p.display_name,
      soryo_kbn: soryoKbn(p.shipping_type),
      display: "1",
      catch_copy1: p.catch_copy_pc,
      catch_copy2: "",
      setumei1: p.description_pc,
      setumei2,
      setumei3: "",
      setumei4: imgList,
      setumei5: "",
      setumei6: "",
      setumei7: "",
      setumei8: "",
      setumei9: "",
      setumei10: "",
      keyword: p.keyword,
      ...gazou,
      sentakusi_yoko_name: "",
      spec1: String(p.delivery_method),
      spec2: String(p.lead_time),
      spec3: `${p.delivery_method}営業日出荷`,
      spec4: "",
      spec5: "",
      free1: p.free1,
      free2: p.free2,
      free3: String(p.lead_time),
      free4: String(taxInclusive),
      free5: p.catch_copy_pc,
      free6: "",
      free7: "",
      free8: "",
      free9: "",
      free10: "",
      tenpo_kihon_category1: p.store_category,
      tenpo_kihon_category2: "",
      tenpo_kihon_category3: "",
      tenpo_kihon_category4: "",
      tenpo_kihon_category5: "",
      tenpo_kihon_category6: "",
      tenpo_kihon_category7: "",
      tenpo_kihon_category8: "",
      tenpo_kihon_category9: "",
      tenpo_kihon_category10: "",
      moru_kihon_category_code: p.mall_category_id,
      zaiko_su_hyoji_kbn: "0",
    };
  }

  private mapSet(p: ProductInput): Record<string, string> {
    const singleCode = singleCodeFromSetCode(p.ne_code);
    const imgList = buildImgListHtml(p.ne_code, p.image_count);
    const setumei2 = imgList ? `${imgList}\n${p.description_pc}` : p.description_pc;
    const gazou = buildGazouUrlsSet(p.ne_code, p.image_count, p.image_url_20);
    const taxInclusive = Math.floor(p.selling_price * (1 + p.tax_rate / 100));

    return {
      set_syohin_code: p.ne_code,
      set_syohin_name: p.product_name,
      set_baika_tnk: String(p.selling_price),
      tax_rate: String(p.tax_rate),
      syohin_code: singleCode,
      suryo: String(p.quantity),
      jan_code: p.jan_code,
      daihyo_syohin_code: "",
      hyoji_tnk: "",
      zei_kbn: "0",
      package_haba: "",
      package_okuyuki: "",
      package_takasa: "",
      package_omosa: "",
      hasou_kikan_kbn: "",
      size: "",
      gift_ok_flg: "",
      noshi_kbn: "",
      iro: "",
      brand_name: p.brand_name,
      maker_kataban: "",
      maker_name: p.maker_name,
      hanbai_kaisi_bi: "",
      hanbai_syuryo_bi: "",
      kataban: "",
      location: "",
      syohin_jyotai_kbn: "",
      syohin_jyotai_setumei: "",
      page_syohin_name: p.display_name,
      soryo_kbn: soryoKbn(p.shipping_type),
      display: "1",
      catch_copy1: p.catch_copy_pc,
      catch_copy2: "",
      setumei1: p.description_pc,
      setumei2,
      setumei3: "",
      setumei4: imgList,
      setumei5: "",
      setumei6: "",
      setumei7: "",
      setumei8: "",
      setumei9: "",
      setumei10: "",
      keyword: p.keyword,
      ...gazou,
      sentakusi_yoko_name: p.option_item_name,
      spec1: String(p.delivery_method),
      spec2: String(p.lead_time),
      spec3: `${p.delivery_method}営業日出荷`,
      spec4: "",
      spec5: "",
      free1: p.free1,
      free2: p.free2,
      free3: String(p.quantity),
      free4: String(taxInclusive),
      free5: p.catch_copy_pc,
      free6: "",
      free7: "",
      free8: "",
      free9: "",
      free10: "",
      tenpo_kihon_category1: p.store_category,
      tenpo_kihon_category2: "",
      tenpo_kihon_category3: "",
      tenpo_kihon_category4: "",
      tenpo_kihon_category5: "",
      tenpo_kihon_category6: "",
      tenpo_kihon_category7: "",
      tenpo_kihon_category8: "",
      tenpo_kihon_category9: "",
      tenpo_kihon_category10: "",
      moru_kihon_category_code: p.mall_category_id,
      zaiko_su_hyoji_kbn: "0",
    };
  }
}
