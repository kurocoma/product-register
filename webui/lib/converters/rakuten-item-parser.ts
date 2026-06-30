import { VariantSchema, type ProductInput, type Variant } from "@/lib/product/schema";
import { DEFAULT_RAKUTEN_STORE } from "@/lib/rakuten/store";

/** variants.{id}.attributes[] → アプリ属性配列。多値属性は先頭値を採用（必須属性は単一値）、名前/値が空の項目は除外。 */
function parseVariantAttributes(
  rawAttrs: unknown,
): { item: string; value: string; unit: string; requirement: string }[] {
  if (!Array.isArray(rawAttrs)) return [];
  return rawAttrs
    .map((a) => {
      const at = (a ?? {}) as { name?: unknown; values?: unknown; unit?: unknown };
      const item = typeof at.name === "string" ? at.name : "";
      const values = Array.isArray(at.values) ? at.values.filter((x): x is string => typeof x === "string") : [];
      const unit = typeof at.unit === "string" ? at.unit : "";
      return { item, value: values[0] ?? "", unit, requirement: "" };
    })
    .filter((a) => a.item !== "" && a.value !== "");
}

/** items.get の images[].location("/画像パス")を公開URLへ変換する。
 * 既に http(s) 完全URLならそのまま。GOLD は gold ドメイン、CABINET は image ドメイン。 */
function toRakutenImageUrl(img: { type?: unknown; location?: unknown }): string {
  const loc = typeof img.location === "string" ? img.location.trim() : "";
  if (!loc) return "";
  if (/^https?:\/\//i.test(loc)) return loc;
  if (img.type === "GOLD") return `https://www.rakuten.ne.jp/gold/${DEFAULT_RAKUTEN_STORE}${loc}`;
  return `https://image.rakuten.co.jp/${DEFAULT_RAKUTEN_STORE}/cabinet${loc}`;
}

/** 楽天 items.get の JSON から、編集対象になる項目を ProductInput 部分へパースする。
 * 在庫数は items.get に含まれない（InventoryAPI 管轄）ため対象外。
 * 構造は実機 items.get で確認済み（docs/楽天/items.get.txt / 03-商品取得検索）。 */
/** 楽天 ID 値(配送方法セット番号 shippingMethodGroup・納期管理番号 normalDeliveryDateId 等)は
 *  文字列("10")でも数値(2)でも返るため、トリム済み文字列へ正規化する（空/欠落は ""）。 */
export function rakutenIdToString(x: unknown): string {
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  if (typeof x === "string") return x.trim();
  return "";
}

export function parseRakutenItem(
  json: Record<string, unknown>,
  opts?: { merchantSku?: string },
): Partial<ProductInput> & {
  _variantId?: string;
  _rakutenShippingGroup?: string;
  _rakutenDeliveryDateId?: string;
} {
  const out: Partial<ProductInput> & {
    _variantId?: string;
    _rakutenShippingGroup?: string;
    _rakutenDeliveryDateId?: string;
  } = {};

  if (typeof json.title === "string") out.display_name = json.title;
  if (typeof json.genreId === "string") out.mall_category_id = json.genreId;

  const desc = json.productDescription as { pc?: string; sp?: string } | undefined;
  if (desc) {
    if (typeof desc.pc === "string") out.description_pc = desc.pc;
    if (typeof desc.sp === "string") out.description_sp = desc.sp;
  }
  // 楽天キャッチコピー(tagline)を PC用と Yahoo headline 用の両方へ反映する。
  // headline は全角30・HTML不可だが item-mapper の fitYahooField が整形するため超過しても安全。
  if (typeof json.tagline === "string") {
    out.catch_copy_pc = json.tagline;
    out.catch_copy_yahoo = json.tagline;
  }

  // 商品オプション(項目選択肢) customizationOptions → { name, values }[]。
  // 選択肢を持つもののみ採用（Yahoo options=自由文形式へ後段で整形）。
  const copts = json.customizationOptions;
  if (Array.isArray(copts)) {
    const options = copts
      .map((o) => {
        const opt = (o ?? {}) as { displayName?: unknown; selections?: unknown };
        const name = typeof opt.displayName === "string" ? opt.displayName : "";
        const values = Array.isArray(opt.selections)
          ? opt.selections
              .map((s) => (s && typeof s === "object" ? (s as { displayValue?: unknown }).displayValue : ""))
              .filter((v): v is string => typeof v === "string" && v !== "")
          : [];
        return { name, values };
      })
      .filter((o) => o.name !== "" && o.values.length > 0);
    if (options.length > 0) out.customization_options = options;
  }

  // 商品画像 images[].location → 実画像URLとして image_url_1..20 + image_count に取り込む。
  // 実画像は thum01 や JAN名フォルダ等アプリの自動生成規約(thum02/{ne_code})と一致しないため、
  // 算出ではなく取得した実URLをそのまま保持する。
  const images = json.images;
  if (Array.isArray(images) && images.length > 0) {
    const urls = images
      .map((img) => toRakutenImageUrl((img ?? {}) as { type?: unknown; location?: unknown }))
      .filter((u) => u !== "");
    if (urls.length > 0) {
      out.image_count = urls.length;
      urls.slice(0, 20).forEach((u, i) => {
        (out as Record<string, unknown>)[`image_url_${i + 1}`] = u;
      });
    }
  }

  // 対象 variant から SKU管理番号・価格・JAN を取り出す。
  // 多SKU商品(1商品ページに複数SKU)を merchantDefinedSkuId(=NEコード)指定で取込む場合は、
  // 先頭でなく一致する variant を選ぶ（SKU検索取込で別SKUを誤取込しないため）。
  const variants = json.variants as Record<string, Record<string, unknown>> | undefined;
  if (variants) {
    let targetId = Object.keys(variants)[0];
    if (opts?.merchantSku) {
      const found = Object.keys(variants).find((k) => {
        const ms = variants[k]?.merchantDefinedSkuId;
        return typeof ms === "string" && ms.trim() === opts.merchantSku;
      });
      if (found) targetId = found;
    }
    if (targetId) {
      out._variantId = targetId;
      // variant キー(SKU管理番号)を保持。upsert/patch の variants.{key} に使う実キー。
      out.rakuten_variant_id = targetId;
      const v = variants[targetId];
      // NEコード = システム連携用SKU番号(merchantDefinedSkuId)を優先。無ければ variant キー(SKU管理番号)。
      const merchantSku = typeof v.merchantDefinedSkuId === "string" ? v.merchantDefinedSkuId.trim() : "";
      out.ne_code = merchantSku || targetId;
      if (typeof v.standardPrice === "string") out.selling_price = parsePrice(v.standardPrice);
      // 消費税率は楽天の実値(taxRate)を採用（軽減8%/標準10%の混在対応）。未返却時は既定10。
      const tr = parseTaxRate(v.taxRate);
      if (tr !== undefined) out.tax_rate = tr;
      const art = v.articleNumber as { value?: string } | undefined;
      if (art && typeof art.value === "string") out.jan_code = art.value;
      const ship = v.shipping as { postageIncluded?: boolean; shippingMethodGroup?: unknown } | undefined;
      if (ship) out.shipping_type = ship.postageIncluded ? "送料無料" : "送料別";
      // 配送方法セット番号・納期管理番号は Yahoo へのマッピング解決用に保持（数値/文字列両対応）。
      out._rakutenShippingGroup = rakutenIdToString(ship?.shippingMethodGroup);
      out._rakutenDeliveryDateId = rakutenIdToString(v.normalDeliveryDateId);

      // 商品属性 variants.{id}.attributes[] → product.attributes。
      // これを取り込まないと、ジャンル必須属性が欠落して再登録(upsert)が IE0418 で失敗する。
      const attrs = parseVariantAttributes(v.attributes);
      if (attrs.length > 0) out.attributes = attrs;
    }
  }
  return out;
}

/** standardPrice を整数円へ。桁区切りカンマ("6,220")を除去してから数値化（外部作成商品対策）。
 * 非数/空は 0 にフォールバック。 */
function parsePrice(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 楽天 variant.taxRate（小数 0.08 / 文字列 "0.1"）→ アプリ tax_rate（百分率 8 / 10）。
 * 食品の軽減税率(8%)と標準税率(10%)が商品ごとに混在するため楽天の実値を採用する。
 * 想定外の値・欠落（既定便等で未返却）は undefined を返し、呼び出し側で安全既定(10)へ倒す。 */
export function parseTaxRate(raw: unknown): 8 | 10 | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // 楽天は小数(0.08/0.1)。稀に百分率(8/10)で来ても拾えるよう正規化する。
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  if (pct === 8) return 8;
  if (pct === 10) return 10;
  return undefined;
}

/** variant の選択肢ラベル(例 "24本"・多軸 "赤 / S")を組み立てる。
 * v.selectorValues = { selectorKey: 表示値 }、json.variantSelectors[] がページ表示順(キー順)を定める。 */
function variationLabel(json: Record<string, unknown>, v: Record<string, unknown>): string {
  const sel = v.selectorValues;
  if (!sel || typeof sel !== "object") return "";
  const selMap = sel as Record<string, unknown>;
  const selectors = json.variantSelectors;
  const keys = Array.isArray(selectors)
    ? selectors
        .map((s) => (s && typeof s === "object" && typeof (s as { key?: unknown }).key === "string" ? (s as { key: string }).key : ""))
        .filter(Boolean)
    : Object.keys(selMap);
  return keys
    .map((k) => selMap[k])
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join(" / ");
}

/** 楽天 items.get の全 variant を Variant[] へパースする（多SKU取込 P2）。
 * 各SKUの SKU管理番号(variantキー)・NEコード(merchantDefinedSkuId)・JAN(articleNumber.value)・
 * 標準価格・送料無料/別・属性を抽出。1商品ページの全SKUを variants[] に格納する用途。
 * 配送詳細(送料区分/配送方法セット等)は P4 で拡張。 */
export function parseRakutenVariants(json: Record<string, unknown>): Variant[] {
  const variants = json.variants as Record<string, Record<string, unknown>> | undefined;
  if (!variants) return [];
  return Object.entries(variants).map(([key, v]) => {
    const merchantSku = typeof v.merchantDefinedSkuId === "string" ? v.merchantDefinedSkuId.trim() : "";
    const art = v.articleNumber as { value?: unknown } | undefined;
    const janRaw = typeof art?.value === "string" ? art.value.trim() : "";
    const ship = v.shipping as
      | { postageIncluded?: boolean; fee?: unknown; postageSegment?: { local?: unknown; overseas?: unknown }; shippingMethodGroup?: unknown }
      | undefined;
    const str = (x: unknown): string => (x != null && x !== "" ? String(x) : "");
    return VariantSchema.parse({
      sku_manage_number: key,
      ne_code: merchantSku || key,
      jan_code: /^\d{13}$/.test(janRaw) ? janRaw : "",
      selling_price: parsePrice(v.standardPrice),
      tax_rate: parseTaxRate(v.taxRate) ?? 10,
      quantity: 1,
      variation_value: variationLabel(json, v),
      // 配送詳細(送料無料/別・個別送料・送料区分1/2・配送方法セット)。snapshot比較と取込の両方に使う。
      shipping_type: ship?.postageIncluded ? "送料無料" : "送料別",
      individual_shipping_fee: str(ship?.fee),
      postage_segment_1: str(ship?.postageSegment?.local),
      postage_segment_2: str(ship?.postageSegment?.overseas),
      shipping_method_group: rakutenIdToString(ship?.shippingMethodGroup),
      attributes: parseVariantAttributes(v.attributes),
    });
  });
}
