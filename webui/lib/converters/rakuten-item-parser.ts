import { VariantSchema, VariantSpecSchema, type ProductInput, type Variant } from "@/lib/product/schema";
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

/** variants.{id}.specs[] → 楽天SKU自由入力行。
 * APIレスポンスの不正な要素だけを除外し、公式上限5件までを保持する。プロパティ欠落は
 * undefined のままにして、旧保存データのpatchで楽天上の既存値を誤って消さない。 */
function parseVariantSpecs(rawSpecs: unknown): Variant["specs"] {
  if (!Array.isArray(rawSpecs)) return undefined;
  return rawSpecs
    .map((spec) => VariantSpecSchema.safeParse(spec))
    .filter((result) => result.success)
    .map((result) => result.data)
    .slice(0, 5);
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

  // PC用販売説明文(salesDescription)。imgタグ含む任意HTMLを加工せずそのまま取り込む
  // （反映側 rakuten-api.ts は sale_description_pc を salesDescription へ送るため往復対称になる）。
  const salesDesc = typeof json.salesDescription === "string" ? json.salesDescription : "";
  if (salesDesc) out.sale_description_pc = salesDesc;

  const desc = json.productDescription as { pc?: string; sp?: string } | undefined;
  if (desc) {
    if (typeof desc.pc === "string") out.description_pc = desc.pc;
    if (typeof desc.sp === "string") {
      // 反映側は sp = 販売説明文 + description_sp と前置合成して送るため、
      // 取込時は前置分を剥がし、取込→反映の往復で販売説明文が二重化しないようにする。
      out.description_sp =
        salesDesc && desc.sp.startsWith(salesDesc) ? desc.sp.slice(salesDesc.length) : desc.sp;
    }
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
    if (options.length > 0) {
      out.customization_options = options;
      // フォーム「バリエーション」欄の項目選択肢項目名（NE の sentakusi_yoko_name 用途 = 単一名のため先頭のみ）
      out.option_item_name = options[0].name;
    }
    // 忠実性メタ（260720）: 全オプション（自由入力 FREE_TEXT 含む）の種別・必須フラグを保持。
    // 登録（upsert 全置換）で customizationOptions を劣化なく送り返すために使う。
    const meta = copts
      .map((o) => {
        const opt = (o ?? {}) as { displayName?: unknown; inputType?: unknown; required?: unknown };
        return {
          name: typeof opt.displayName === "string" ? opt.displayName : "",
          input_type: typeof opt.inputType === "string" ? opt.inputType : "SINGLE_SELECTION",
          required: opt.required === true,
        };
      })
      .filter((m) => m.name !== "");
    if (meta.length > 0) out.customization_options_meta = meta;
  }

  // バリエーション軸（variantSelectors）→ フォーム「バリエーション」欄へ（260711修正依頼-8）。
  // 1軸目を採用（アプリのバリエーション欄・楽天反映CSVとも単軸前提）。
  const selectors = json.variantSelectors;
  if (Array.isArray(selectors) && selectors.length > 0) {
    const s0 = (selectors[0] ?? {}) as { key?: unknown; displayName?: unknown; values?: unknown };
    if (typeof s0.key === "string" && s0.key !== "") out.variation_key = s0.key;
    if (typeof s0.displayName === "string" && s0.displayName !== "") out.variation_name = s0.displayName;
    const choiceValues = Array.isArray(s0.values)
      ? s0.values
          .map((v) => (v && typeof v === "object" ? (v as { displayValue?: unknown }).displayValue : ""))
          .filter((x): x is string => typeof x === "string" && x !== "")
      : [];
    if (choiceValues.length > 0) out.variation_choices = choiceValues.join("|");
  }

  // 定期購入（260711修正依頼-5）: 定期専用 itemType は無く、通常商品 + subscription/features で表現される。
  // 有効判定は features.displaySubscriptionCartButton（公式の停止方法 = このボタンを false にする）。
  // 3フィールドとも常に設定する（設定なし＝false）。snapshot に無いと diffProduct が比較を
  // スキップし、「定期なし商品に定期を設定する」編集が反映対象に載らないため。
  const feats = json.features as { displaySubscriptionCartButton?: unknown } | undefined;
  const subs = json.subscription as { shippingDateFlag?: unknown; shippingIntervalFlag?: unknown } | undefined;
  out.subscription_enabled = feats?.displaySubscriptionCartButton === true;
  out.subscription_shipping_date_flag = subs?.shippingDateFlag === true;
  out.subscription_interval_flag = subs?.shippingIntervalFlag === true;

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

  // 白背景画像 whiteBgImage → white_bg_image_url（images[] と同じ CABINET/GOLD location 形式）。
  // 常に設定する（無ければ ""）。取込はモール現状を正とし、楽天側で解除された白背景を
  // 反映(upsert=全置換)で復活させないため（subscription フラグと同じ理由）。
  const wb = json.whiteBgImage as { type?: unknown; location?: unknown } | undefined;
  out.white_bg_image_url = wb ? toRakutenImageUrl(wb) : "";

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
      // 消費税率は商品レベル payment.taxRate が正（実機レスポンスでは variant 直下に taxRate は無い）。
      // variant 側に値が来る場合はそちらを優先し、どちらも無ければ既定10へ倒す。
      const tr = parseTaxRate(v.taxRate) ?? paymentTaxRate(json);
      if (tr !== undefined) out.tax_rate = tr;
      const art = v.articleNumber as { value?: string } | undefined;
      if (art && typeof art.value === "string") out.jan_code = art.value;
      const ship = v.shipping as { postageIncluded?: boolean; shippingMethodGroup?: unknown } | undefined;
      if (ship) out.shipping_type = ship.postageIncluded ? "送料無料" : "送料別";
      // 配送方法セット番号・納期管理番号は Yahoo へのマッピング解決用に保持（数値/文字列両対応）。
      out._rakutenShippingGroup = rakutenIdToString(ship?.shippingMethodGroup);
      out._rakutenDeliveryDateId = rakutenIdToString(v.normalDeliveryDateId);

      // 定期購入価格（対象SKUのもの）。常に設定する（無ければ 0 = 未設定）。
      // フラグ同様、snapshot に持たせないと「定期価格の新規設定」が差分に載らない。
      const subPrice = parseSubscriptionPrice(v.subscriptionPrice);
      out.subscription_base_price = subPrice.base;
      out.subscription_first_price = subPrice.first;

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

/** variant.subscriptionPrice { basePrice, individualPrices.firstPrice } → { base, first }。
 * 欠落・非数は 0（= 未設定。このSKUは通常購入のみ）。 */
function parseSubscriptionPrice(raw: unknown): { base: number; first: number } {
  const sp = (raw ?? {}) as { basePrice?: unknown; individualPrices?: { firstPrice?: unknown } };
  const base = sp.basePrice != null ? parsePrice(sp.basePrice) : 0;
  const first = sp.individualPrices?.firstPrice != null ? parsePrice(sp.individualPrices.firstPrice) : 0;
  return { base, first };
}

/** item 直下 payment.taxRate を読む。楽天 items.get の税率は SKU ではなく商品(payment)レベルにある
 * （実機確認: payment = { taxIncluded, taxRate: "0.08", ... }）。 */
export function paymentTaxRate(json: Record<string, unknown>): 8 | 10 | undefined {
  const pay = json.payment as { taxRate?: unknown } | undefined;
  return parseTaxRate(pay?.taxRate);
}

/** 楽天 taxRate（小数 0.08 / 文字列 "0.1"）→ アプリ tax_rate（百分率 8 / 10）。
 * 食品の軽減税率(8%)と標準税率(10%)が商品ごとに混在するため楽天の実値を採用する。
 * 想定外の値・欠落は undefined を返し、呼び出し側で安全既定(10)へ倒す。 */
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
  // 税率は商品レベル payment.taxRate が正（variant 直下には無い）。全SKU共通のフォールバックとして1回だけ解決する。
  const fallbackTaxRate = paymentTaxRate(json);
  return Object.entries(variants).map(([key, v]) => {
    const merchantSku = typeof v.merchantDefinedSkuId === "string" ? v.merchantDefinedSkuId.trim() : "";
    const art = v.articleNumber as { value?: unknown } | undefined;
    const janRaw = typeof art?.value === "string" ? art.value.trim() : "";
    const ship = v.shipping as
      | { postageIncluded?: boolean; fee?: unknown; postageSegment?: { local?: unknown; overseas?: unknown }; shippingMethodGroup?: unknown }
      | undefined;
    const str = (x: unknown): string => (x != null && x !== "" ? String(x) : "");
    const subPrice = parseSubscriptionPrice(v.subscriptionPrice);
    // SKU画像 images[0]（SKUごとに0..1枚）→ image_url。反映側 rakuten-api.ts と往復対称。
    const img0 = Array.isArray(v.images)
      ? ((v.images[0] ?? undefined) as { type?: unknown; location?: unknown } | undefined)
      : undefined;
    // 表示価格（二重価格）referencePrice.value → display_price。実機は文字列/数値の両表記。
    // value 無し（SHOP_SETTING 等）は未設定のまま（0=連動と区別しない。楽天は「無し」=非表示）。
    const refPrice = (v.referencePrice ?? {}) as { value?: unknown };
    const refValue = refPrice.value != null ? parsePrice(refPrice.value) : 0;
    return VariantSchema.parse({
      sku_manage_number: key,
      ne_code: merchantSku || key,
      image_url: img0 ? toRakutenImageUrl(img0) || undefined : undefined,
      display_price: refValue > 0 ? refValue : undefined,
      // お届けの目安 = 在庫あり時納期管理番号（SKU単位。数値/文字列両対応で正規化）。
      normal_delivery_date_id: rakutenIdToString(v.normalDeliveryDateId),
      jan_code: /^\d{13}$/.test(janRaw) ? janRaw : "",
      selling_price: parsePrice(v.standardPrice),
      subscription_base_price: subPrice.base,
      subscription_first_price: subPrice.first,
      tax_rate: parseTaxRate(v.taxRate) ?? fallbackTaxRate ?? 10,
      quantity: 1,
      variation_value: variationLabel(json, v),
      // 配送詳細(送料無料/別・個別送料・送料区分1/2・配送方法セット)。snapshot比較と取込の両方に使う。
      shipping_type: ship?.postageIncluded ? "送料無料" : "送料別",
      individual_shipping_fee: str(ship?.fee),
      postage_segment_1: str(ship?.postageSegment?.local),
      postage_segment_2: str(ship?.postageSegment?.overseas),
      shipping_method_group: rakutenIdToString(ship?.shippingMethodGroup),
      attributes: parseVariantAttributes(v.attributes),
      specs: parseVariantSpecs(v.specs),
    });
  });
}

/** 編集画面の「モールから取込」用: 楽天snapshotから specs だけを既存SKUへ戻す。
 * items.get では在庫数を取得できないため variants 全体を置換せず、価格・在庫・配送等の
 * ローカル値を必ず保持する。SKU管理番号を優先し、合わない場合だけNEコードで照合する。 */
export function mergeRakutenVariantSpecs(local: Variant[] | undefined, remote: Variant[]): Variant[] {
  const bySku = new Map(
    remote
      .filter((variant) => variant.sku_manage_number.trim() !== "")
      .map((variant) => [variant.sku_manage_number.trim(), variant]),
  );
  const byNe = new Map(
    remote
      .filter((variant) => variant.ne_code.trim() !== "")
      .map((variant) => [variant.ne_code.trim(), variant]),
  );

  return (local ?? []).map((variant) => {
    const sku = variant.sku_manage_number.trim();
    const ne = variant.ne_code.trim();
    const found = (sku ? bySku.get(sku) : undefined) ?? (ne ? byNe.get(ne) : undefined);
    return found ? { ...variant, specs: found.specs } : variant;
  });
}
