import { productVariants, resolveAttributes, type ProductInput, type Variant } from "@/lib/product/schema";
import { baseCodeOf } from "./rakuten";
import { buildCabinetFileName } from "./cabinet-path";
import { buildRakutenImgList } from "./image-url";

/** Variant → 楽天 variant.shipping。送料無料は postageIncluded のみ。送料別は
 * 個別送料(fee) XOR 送料区分(postageSegment.local/overseas) を設定（排他、docs/楽天/04の制約）。
 * 配送方法セット(shippingMethodGroup)は併用可。置き配(okihai)は ItemAPI に項目が無く反映対象外。 */
export function buildVariantShipping(v: Variant): Record<string, unknown> {
  const shipping: Record<string, unknown> = {};
  if (v.shipping_type === "送料無料") {
    shipping.postageIncluded = true; // 送料無料時は fee/postageSegment 不可（排他）
  } else {
    shipping.postageIncluded = false;
    const fee = v.individual_shipping_fee?.trim();
    if (fee) {
      shipping.fee = fee; // 個別送料（送料区分とは排他）
    } else {
      const seg: Record<string, number> = {};
      const s1 = Number(v.postage_segment_1);
      const s2 = Number(v.postage_segment_2);
      if (v.postage_segment_1?.trim() && Number.isFinite(s1)) seg.local = s1;
      if (v.postage_segment_2?.trim() && Number.isFinite(s2)) seg.overseas = s2;
      if (Object.keys(seg).length > 0) shipping.postageSegment = seg;
    }
  }
  // 配送方法セットは送料無料/別どちらでも併用可（postageIncluded時も禁止されない）。
  const grp = v.shipping_method_group?.trim();
  if (grp) shipping.shippingMethodGroup = grp;
  return shipping;
}

/** patch用 variant.shipping。楽天 items.patch は shipping(object)をマージ(省略キーは保持)するため
 * (実機検証: 個別送料fee付きSKUに postageIncluded:true だけ送ると IE0153)、モード切替で旧値が残らないよう
 * 設定しないキーを明示的に null で送ってクリアする(実機で null クリア成功を確認)。 */
export function buildVariantShippingForPatch(v: Variant): Record<string, unknown> {
  const grp = v.shipping_method_group?.trim();
  const shipping: Record<string, unknown> = { shippingMethodGroup: grp || null };
  if (v.shipping_type === "送料無料") {
    shipping.postageIncluded = true;
    shipping.fee = null;
    shipping.postageSegment = null;
    return shipping;
  }
  shipping.postageIncluded = false;
  const fee = v.individual_shipping_fee?.trim();
  if (fee) {
    shipping.fee = fee;
    shipping.postageSegment = null; // 個別送料とは排他→区分クリア
    return shipping;
  }
  const seg: Record<string, number> = {};
  const s1 = Number(v.postage_segment_1);
  const s2 = Number(v.postage_segment_2);
  if (v.postage_segment_1?.trim() && Number.isFinite(s1)) seg.local = s1;
  if (v.postage_segment_2?.trim() && Number.isFinite(s2)) seg.overseas = s2;
  shipping.fee = null; // 区分または無指定→個別送料クリア
  shipping.postageSegment = Object.keys(seg).length > 0 ? seg : null;
  return shipping;
}

/** 多SKUの選択肢ラベル一覧（variantSelectors.values / selectorValues 用）。
 * variation_value 優先、無ければ数量(N本)、それも無ければ連番。空・重複は連番を付与して一意化(32字以内)。 */
function uniqueVariationLabels(vlist: Variant[]): string[] {
  const used = new Set<string>();
  return vlist.map((v, i) => {
    const base = (v.variation_value?.trim() || (v.quantity > 0 ? `${v.quantity}本` : "") || `タイプ${i + 1}`).slice(0, 32);
    let label = base;
    let n = 2;
    while (used.has(label)) label = `${base.slice(0, 28)}(${n++})`;
    used.add(label);
    return label;
  });
}

/** アプリ属性配列 → 楽天 variants.{}.attributes[]（item/value が入っているものだけ、unit任意）。
 * ジャンル必須属性(総入数等)を満たすため、upsert だけでなく patch でも variant に同梱する。 */
export function buildRakutenAttributes(
  attrs: { item?: string; value?: string; unit?: string }[] | undefined,
): { name: string; values: string[]; unit?: string }[] {
  return (attrs || [])
    .filter((a): a is { item: string; value: string; unit?: string } => !!a.item && !!a.value)
    .map((a) => (a.unit ? { name: a.item, values: [a.value], unit: a.unit } : { name: a.item, values: [a.value] }));
}

/** SKU(variant)の属性を楽天 variants.{}.attributes[] へ。variant固有の属性(item+value)が
 * あればそれを優先し、無ければ商品共通の属性(p.attributes / 旧attribute_1..5)へフォールバックする。
 * 多SKU商品で各variantに必須属性(ブランド名・総入数等)を確実に同梱し、
 * items.upsert 時の IE0418(必須属性欠落)を防ぐ。CSV経路(rakuten.ts の buildChildRow)と同じ規則。 */
function buildVariantAttributes(
  v: Variant,
  p: ProductInput,
): { name: string; values: string[]; unit?: string }[] {
  const own = buildRakutenAttributes(v.attributes);
  if (own.length > 0) return own;
  return buildRakutenAttributes(resolveAttributes(p, { onlyWithValue: true }));
}

/** 楽天 variant キー(SKU管理番号 = variants.{key})。取込商品は実キー(rakuten_variant_id)を保持しており、
 * NEコード(merchantDefinedSkuId)と別物の外部作成商品でも正しいキーで upsert/patch する。
 * 未保持(新規登録・アプリ作成)は従来どおり ne_code を使う。 */
export function rakutenVariantId(p: ProductInput): string {
  const stored = p.rakuten_variant_id?.trim();
  return stored || p.ne_code;
}

/** 商品管理番号（items.upsert / items.patch / items.get のパス）。
 * 取込商品は実際の管理番号(rakuten_manage_number)を保存しているので最優先で使う
 * （非規約書式でも編集→反映で同一商品へ往復する）。未保存（新規登録・既存商品）は
 * 従来どおり baseCodeOf を冪等キーに使う。 */
export function buildRakutenManageNumber(p: ProductInput): string {
  const stored = p.rakuten_manage_number?.trim();
  if (stored) return stored;
  return baseCodeOf(p);
}

/** 商品画像 images[].location（"/フォルダ/ファイル名.jpg" 形式。/cabinet/ 以降のパス）を
 * 命名規約から算出する。**規約名で実際にアップロードした直後にだけ使ってよい**
 * （rcabinet-sync: アップロード→この規約パスで patch→ローカル書換、で自己完結）。
 * upsert には使わない（未アップロードの机上パスで RMS を上書きし画像リンク切れになる）。 */
export function buildImageLocations(p: ProductInput): { type: "CABINET"; location: string }[] {
  const count = Math.max(1, Math.min(20, p.image_count));
  const out: { type: "CABINET"; location: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const t = buildCabinetFileName(p, { kind: "main", index: i });
    out.push({ type: "CABINET", location: `/${t.folder}/${t.filePath}` });
  }
  return out;
}

/** upsert 用の商品画像 images[]。保存済みの実URL（image_url_1..image_count。取込が保持した
 * モール現物のパス）を最優先し、未設定・変換不能な index のみ命名規約で補完する。
 * 取込→登録の往復対称を守る（r2201-1 実件: 規約算出で送ると実在しないパスに差し替わる）。 */
export function buildUpsertImages(p: ProductInput): { type: "CABINET"; location: string }[] {
  const count = Math.max(1, Math.min(20, p.image_count));
  const rec = p as unknown as Record<string, unknown>;
  const out: { type: "CABINET"; location: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const stored = rec[`image_url_${i}`];
    const loc = cabinetLocationFromUrl(typeof stored === "string" ? stored : undefined);
    if (loc) {
      out.push({ type: "CABINET", location: loc });
    } else {
      const t = buildCabinetFileName(p, { kind: "main", index: i });
      out.push({ type: "CABINET", location: `/${t.folder}/${t.filePath}` });
    }
  }
  return out;
}

/** 商品オプション（customizationOptions）の送出（260720）。
 * 編集用の customization_options（選択肢あり）に、忠実性メタ（種別・必須フラグ。
 * 自由入力 FREE_TEXT はメタのみ）を name で対応付けて楽天形式へ戻す。
 * upsert は全置換のため、これを送らないと登録のたびに楽天側の商品オプションが消える。 */
export function buildCustomizationOptions(p: ProductInput): Record<string, unknown>[] {
  const metaByName = new Map((p.customization_options_meta ?? []).map((m) => [m.name, m]));
  const out: Record<string, unknown>[] = [];
  for (const o of p.customization_options ?? []) {
    if (!o.name || o.values.length === 0) continue;
    const meta = metaByName.get(o.name);
    out.push({
      displayName: o.name,
      inputType: meta?.input_type ?? "SINGLE_SELECTION",
      required: meta?.required ?? false,
      selections: o.values.map((v) => ({ displayValue: v })),
    });
    metaByName.delete(o.name);
  }
  // 自由入力等（編集用リストに無い・メタのみのオプション）を維持して送る。
  // 選択式なのに選択肢が無い残骸（アプリで削除されたオプションのメタ）は送らない＝復活させない。
  for (const m of metaByName.values()) {
    if (m.input_type === "SINGLE_SELECTION") continue;
    out.push({ displayName: m.name, inputType: m.input_type, required: m.required });
  }
  return out;
}

/** 画像URL → images[].location（"/フォルダ/ファイル名.jpg"）。
 * buildImageLocations と同じ location 形式（items.upsert の location は
 * `https://image.rakuten.co.jp/[SHOP_URL]/cabinet/画像パス` の "/画像パス" 部分のみ）。
 * 白背景画像(whiteBgImage)・SKU画像(variants.{}.images)の組み立てに使う。
 * - 既に "/..." パス形式ならそのまま採用
 * - R-Cabinet 公開URLなら /cabinet 以降を抽出（クエリ・フラグメントは除去）
 * - それ以外（GOLD・外部URL・空）は null = キー自体を送らない（不正 location の送信防止） */
export function cabinetLocationFromUrl(url: string | undefined): string | null {
  const u = (url ?? "").trim().split(/[?#]/)[0];
  if (!u) return null;
  if (u.startsWith("/")) return u;
  const m = /^https?:\/\/image\.rakuten\.co\.jp\/[^/]+\/cabinet(\/.+)$/i.exec(u);
  return m ? m[1] : null;
}

export type RakutenUpsertBody = Record<string, unknown>;

export type BuildUpsertOptions = {
  /** true で倉庫(非公開)指定。 */
  hideItem?: boolean;
  /** true でサーチ在庫数を非表示(HIDDEN_STOCK)にする。安全登録用。 */
  hideStock?: boolean;
};

/** ProductInput → items.upsert リクエストボディ。
 * 多SKU(variants[])は全SKUを variants{} に展開。単品(variants未設定)は productVariants() が
 * フラットから1件合成するため従来と同一bodyになる（後方互換）。upsertは全置換。
 * 在庫は InventoryAPI 別送（本体に含めない）。 */
export function buildRakutenUpsertBody(p: ProductInput, opts: BuildUpsertOptions = {}): RakutenUpsertBody {
  const imgList = buildRakutenImgList(baseCodeOf(p), p.image_count);

  const vlist = productVariants(p);
  const multi = vlist.length > 1;
  // 多SKUは variantSelectors(バリエーション軸) + 各variantの selectorValues が必須(IE0269)。
  // 単軸とし、選択肢ラベルは variation_value（無ければ数量/連番）。重複・空は連番付与で一意化。
  const axisKey = "type";
  const axisName = (p.yahoo_variation_title?.trim() || "タイプ").slice(0, 32); // displayName は string(32)
  const labels = multi ? uniqueVariationLabels(vlist) : [];

  // SKUごとに variants.{key} を組み立てる（key = SKU管理番号、無ければ NEコード）。
  const variants: Record<string, unknown> = {};
  vlist.forEach((v, i) => {
    const key = v.sku_manage_number?.trim() || v.ne_code;
    // articleNumber: 13桁JANがあれば value、無ければ店舗オリジナル(3)
    const articleNumber = /^\d{13}$/.test(v.jan_code) ? { value: v.jan_code } : { exemptionReason: 3 };
    const variant: Record<string, unknown> = {
      // システム連携用SKU番号 = NEコード。取込→編集→反映や再登録で NE連携番号を保持する。
      merchantDefinedSkuId: v.ne_code,
      standardPrice: String(v.selling_price),
      articleNumber,
      shipping: buildVariantShipping(v),
    };
    // 定期購入価格（260711修正依頼-5）: 定期販売有効かつこのSKUに定期価格があるときだけ送る
    // （定期価格の無いSKUは通常購入のみ、という楽天仕様の表現）。
    if (p.subscription_enabled && (v.subscription_base_price ?? 0) > 0) {
      variant.subscriptionPrice = {
        basePrice: String(v.subscription_base_price),
        ...((v.subscription_first_price ?? 0) > 0
          ? { individualPrices: { firstPrice: String(v.subscription_first_price) } }
          : {}),
      };
    }
    // 表示価格（二重価格）。display_price>0 のときだけ referencePrice を送る（税別のため値は税抜のまま）。
    // 文言 type は 1:当店通常価格 固定（取込側も value のみ保持。docs/楽天/04 #97-99）。
    if ((v.display_price ?? 0) > 0) {
      variant.referencePrice = { displayType: "REFERENCE_PRICE", type: 1, value: String(v.display_price) };
    }
    // お届けの目安 = 在庫あり時納期管理番号（SKU単位）。空 = 未設定 = 送らない。
    const ndd = Number(v.normal_delivery_date_id);
    if (v.normal_delivery_date_id?.trim() && Number.isFinite(ndd)) {
      variant.normalDeliveryDateId = ndd;
    }
    const attributes = buildVariantAttributes(v, p);
    if (attributes.length > 0) variant.attributes = attributes;
    if (multi) variant.selectorValues = { [axisKey]: labels[i] };
    // SKU管理画像（variants.{}.images、SKUごとに0..1枚）。商品レベル images と同じ
    // { type: "CABINET", location: "/画像パス" } 形式（cabinetLocationFromUrl で変換）。
    // CSV経路(rakuten.ts)と同様、バリエーションなし（単一SKU）に SKU画像を入れると
    // 楽天側でエラーになるため多SKU時のみ送る。URLが空・cabinet外はキー自体を付けない。
    if (multi) {
      const skuImageLocation = cabinetLocationFromUrl(v.image_url);
      if (skuImageLocation) {
        // alt は HTML 不可（IE0218）。display_name の <br> 等を平文化してから使う。
        const alt = plainTextAlt(p.display_name);
        variant.images = [
          { type: "CABINET", location: skuImageLocation, ...(alt ? { alt } : {}) },
        ];
      }
    }
    variants[key] = variant;
  });

  // PC用販売説明文: 任意入力(sale_description_pc)があればそれを、空なら画像から自動生成した imgList
  // （CSV出力 rakuten.ts と同じ規則。取込した salesDescription を反映で失わない往復対称のため）。
  const saleBlock = p.sale_description_pc.trim() ? p.sale_description_pc : imgList;
  const body: RakutenUpsertBody = {
    title: p.display_name,
    itemType: "NORMAL",
    genreId: p.mall_category_id,
    productDescription: { pc: p.description_pc, sp: saleBlock + p.description_sp },
    salesDescription: saleBlock,
    images: buildUpsertImages(p),
    // 税別登録（taxIncluded: false）。当店の楽天商品は税別で登録されており（items.get の
    // standardPrice = 税抜値・実ページの税込表示は楽天側が計算）、アプリの selling_price も
    // 全モール税抜統一のため。true で送ると税抜額が税込価格として登録され実売価格が下がる（260715修正）。
    payment: { taxIncluded: false, taxRate: String(p.tax_rate / 100) },
    variants,
  };
  if (multi) {
    body.variantSelectors = [{ key: axisKey, displayName: axisName, values: labels.map((l) => ({ displayValue: l })) }];
  }
  // 白背景画像（whiteBgImage、商品レベルで0..1枚）。location は images[] と同じ "/画像パス" 形式。
  // 未設定・cabinet 公開URLでない値はキー自体を送らない（不正 location での upsert 失敗防止）。
  const wbLocation = cabinetLocationFromUrl(p.white_bg_image_url);
  if (wbLocation) body.whiteBgImage = { type: "CABINET", location: wbLocation };
  // 商品オプション（項目選択肢）。upsert は全置換のため、送らないと楽天側から消える（260720）。
  const customization = buildCustomizationOptions(p);
  if (customization.length > 0) body.customizationOptions = customization;
  if (p.catch_copy_pc) body.tagline = p.catch_copy_pc;
  if (opts.hideItem) body.hideItem = true;
  if (opts.hideStock) {
    body.unlimitedInventoryFlag = false;
    body.features = { inventoryDisplay: "HIDDEN_STOCK" };
  }
  // 定期購入（260711修正依頼-5）: 定期専用 itemType は無く subscription + features で表現する。
  // 定期ボタン true のとき通常ボタンも true が必須（IE0432）。価格等の事前検証は validateSubscription。
  if (p.subscription_enabled) {
    body.subscription = {
      shippingDateFlag: p.subscription_shipping_date_flag,
      shippingIntervalFlag: p.subscription_interval_flag,
    };
    body.features = {
      ...((body.features as Record<string, unknown>) ?? {}),
      displayNormalCartButton: true,
      displaySubscriptionCartButton: true,
    };
  }
  return body;
}

/** 画像 alt 用の平文化。楽天は images[].alt に HTML を許可しない（IE0218）ため、
 * タグ（<br> 等・山括弧で囲まれた区間）をスペースに置き換え、残る半角山括弧も除去する。
 * 全角の＜＞は HTML ではないので残す。display_name には楽天の商品名運用で <br> が
 * 普通に入るため（r3001-1 実件）、alt に使う前に必ずこれを通す。 */
export function plainTextAlt(s: string | undefined): string {
  return String(s ?? "")
    .replace(/<[^>]*>/g, " ") // タグ（山括弧で囲まれた区間）→スペース
    .replace(/[<>]/g, "")     // 対にならない山括弧も除去
    .replace(/\s+/g, " ")
    .trim();
}

/** 定期購入設定の事前検証（楽天エラー IE0179/IE0430/IE0431/IE0433/IE0434 を送信前に検出する）。
 * 資料: obsidian 50-api-manual/rakuten-subscription-product-registration.md（2026-07-11 実機確認）。 */
export function validateSubscription(p: ProductInput): { ok: true } | { ok: false; errors: string[] } {
  if (!p.subscription_enabled) return { ok: true };
  const errors: string[] = [];
  if (!p.subscription_shipping_date_flag && !p.subscription_interval_flag) {
    errors.push("お届け日付指定・お届け間隔指定の少なくとも一方を有効にしてください（IE0179）");
  }
  const vlist = productVariants(p);
  const withBase = vlist.filter((v) => (v.subscription_base_price ?? 0) > 0);
  if (withBase.length === 0) {
    errors.push("少なくとも1つのSKUに定期購入価格を設定してください（IE0433）");
  }
  for (const v of vlist) {
    const label = v.ne_code || v.sku_manage_number;
    const base = v.subscription_base_price ?? 0;
    const first = v.subscription_first_price ?? 0;
    if (first > 0 && base <= 0) {
      errors.push(`SKU ${label}: 初回価格だけの設定はできません。定期購入価格も設定してください（IE0434）`);
    }
    if (base > 0) {
      if (v.selling_price <= 0) {
        errors.push(`SKU ${label}: 通常販売価格が0のため定期購入を設定できません（IE0431）`);
      } else {
        // 定期価格・初回価格とも通常価格から5%以上の割引が必要（IE0430）
        const limit = v.selling_price * 0.95;
        if (base > limit) {
          errors.push(`SKU ${label}: 定期購入価格は通常価格から5%以上割引が必要です（通常${v.selling_price}円 → ${Math.floor(limit)}円以下）`);
        }
        if (first > 0 && first > limit) {
          errors.push(`SKU ${label}: 初回価格は通常価格から5%以上割引が必要です（通常${v.selling_price}円 → ${Math.floor(limit)}円以下）`);
        }
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** upsert に最低限必要な項目が揃っているか検証する。 */
export function validateUpsertBody(
  manageNumber: string,
  body: RakutenUpsertBody,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!manageNumber || !/^[a-zA-Z0-9_-]+$/.test(manageNumber)) missing.push("manageNumber(英数-_)");
  if (!body.title) missing.push("title");
  if (!body.itemType) missing.push("itemType");
  if (!body.genreId || !/^\d{6}$/.test(String(body.genreId))) missing.push("genreId(6桁)");
  const variants = body.variants as
    | Record<string, { standardPrice?: string; images?: { alt?: string }[] }>
    | undefined;
  if (!variants || Object.keys(variants).length === 0) missing.push("variants");
  else if (!Object.values(variants)[0]?.standardPrice) missing.push("variants.standardPrice");
  // SKU画像 alt の HTML 混入を送信前に検出（IE0218 の防御。通常は plainTextAlt 済みで通らない）
  for (const [key, v] of Object.entries(variants ?? {})) {
    (v.images ?? []).forEach((img, i) => {
      if (/[<>]/.test(img?.alt ?? "")) {
        missing.push(`variants.${key}.images[${i}].alt にHTML不可（IE0218。タグ・山括弧を除去）`);
      }
    });
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
