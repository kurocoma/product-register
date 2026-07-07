// Shopify parser / patch のオフライン検証（API 呼び出しなし・fixture のみ）。
// 実行: npx tsx tests/verify_shopify_patch.mjs
import { ProductInputSchema } from "../lib/product/schema.ts";
import { addTableClass } from "../lib/converters/shopify.ts";
import {
  parseShopifyItem, stripImgList, extractImgList, taxRateFromTags, taxExcludedPrice,
  makerNameFromVendor, vendorCodeSuffix,
} from "../lib/converters/shopify-item-parser.ts";
import {
  buildShopifyPatchPlan, detectShopifyStructuralChange, buildExpectedBodyHtml,
  buildExpectedVendor, buildExpectedTags, sameTagSet,
} from "../lib/converters/shopify-patch.ts";
import { toProductGid, gidToNumericId } from "../lib/shopify/product-client.ts";
import { inventoryScopeHint } from "../lib/shopify/inventory-client.ts";

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// ---- fixture: 本アプリ CSV 規約で登録された想定の Shopify 商品（税率8%・2SKU） ----
// 拡張分: productType / seo / タグ（アプリ管理外の「ギフト対応」を含む）/
//         variant の compareAtPrice / taxable / inventoryQuantity / inventoryItem（sku・tracked・cost）
const DESC = '<p>黒糖しょうがぱうだー</p><table border="1"><tr><td>内容量</td><td>200g</td></tr></table>';
const IMG_BLOCK = '<!--imgList--><img src="https://cdn.shopify.com/s/files/1/x/files/t002-2542_2.jpg" width="100%"><br><!--/imgList-->';
const BODY = `${IMG_BLOCK}\n${addTableClass(DESC)}`;
const SEO_TITLE = "黒糖しょうがぱうだー 200g|【くりま】沖縄県産品・特産品の通販サイト";
const SEO_DESC = "黒糖しょうがぱうだー 200gのことなら沖縄県産品・特産品の通販サイトくりま。";
const snap = {
  id: "gid://shopify/Product/1234567890",
  title: "黒糖しょうがぱうだー 200g",
  descriptionHtml: BODY,
  status: "ACTIVE",
  vendor: "海邦商事<br>商品コード:t002-2542",
  handle: "t002-2542",
  productType: "食品",
  tags: ["海邦商事", "税率8%", "ギフト対応"],
  seo: { title: SEO_TITLE, description: SEO_DESC },
  variants: [
    {
      id: "gid://shopify/ProductVariant/111", title: "1袋", sku: "t002-2542-1",
      price: "540", compareAtPrice: null, barcode: "4955028002542",
      taxable: true, inventoryQuantity: 25,
      inventoryItem: { id: "gid://shopify/InventoryItem/911", sku: "t002-2542-1", tracked: true, cost: "300.0" },
    },
    {
      id: "gid://shopify/ProductVariant/222", title: "3袋セット(送料無料)", sku: "t002-2542-3",
      price: "1404", compareAtPrice: "2160", barcode: "4955028002542",
      taxable: true, inventoryQuantity: 8,
      inventoryItem: { id: "gid://shopify/InventoryItem/922", sku: "t002-2542-3", tracked: true, cost: null },
    },
  ],
};

// アプリ側の同一商品（selling_price は税抜: 540/1.08=500, 1404/1.08=1300。
// SKU2 の display_price=2000 は compareAtPrice 2160 の税抜逆算。
// shopify_overrides は snapshot と同値 = 変更なし想定の既定）
const appProduct = (over = {}, variantOver = [{}, {}]) => ProductInputSchema.parse({
  ne_code: "t002-2542-1", jan_code: "4955028002542", maker_code: "t002",
  product_type: "単品", quantity: 1,
  product_name: "黒糖しょうがぱうだー 200g", display_name: "黒糖しょうがぱうだー 200g",
  tax_rate: 8, cost_price: 0, selling_price: 500, shipping_type: "送料別",
  image_count: 2, delivery_method: 4, lead_time: 1, mall_category_id: "",
  description_pc: DESC,
  maker_name: "海邦商事",
  shopify_product_id: "gid://shopify/Product/1234567890",
  shopify_overrides: { status: "ACTIVE", product_type: "食品", seo_title: SEO_TITLE, seo_description: SEO_DESC },
  variants: [
    { ne_code: "t002-2542-1", jan_code: "4955028002542", selling_price: 500, tax_rate: 8, quantity: 1, variation_value: "1袋", shipping_type: "送料別", ...variantOver[0] },
    { ne_code: "t002-2542-3", jan_code: "4955028002542", selling_price: 1300, display_price: 2000, tax_rate: 8, quantity: 3, variation_value: "3袋セット", shipping_type: "送料無料", ...variantOver[1] },
  ],
  ...over,
});

// ---- 1) ユーティリティ ----
check("toProductGid: 数値ID → gid", toProductGid("1234567890") === "gid://shopify/Product/1234567890");
check("toProductGid: gid はそのまま", toProductGid("gid://shopify/Product/99") === "gid://shopify/Product/99");
check("toProductGid: 不正入力は null", toProductGid("abc-123") === null);
check("gidToNumericId", gidToNumericId("gid://shopify/Product/42") === "42");
check("taxRateFromTags: 税率8%", taxRateFromTags(["海邦商事", "税率8%"]) === 8);
check("taxRateFromTags: 無し → undefined", taxRateFromTags(["foo"]) === undefined);
check("taxExcludedPrice: 540(8%) → 500", taxExcludedPrice("540", 8) === 500);
check("taxExcludedPrice: 594.00(8%) → 550", taxExcludedPrice("594.00", 8) === 550);
check("stripImgList: 画像ブロック除去", stripImgList(BODY) === addTableClass(DESC));
check("extractImgList: ブロック抽出", extractImgList(BODY) === IMG_BLOCK);
check("stripImgList: ブロック無しは全文", stripImgList("<p>x</p>") === "<p>x</p>");
check("makerNameFromVendor: 規約 Vendor からメーカー名", makerNameFromVendor("海邦商事<br>商品コード:t002-2542") === "海邦商事");
check("makerNameFromVendor: 接尾辞なしは全体", makerNameFromVendor("Nike") === "Nike");
check("vendorCodeSuffix: 接尾辞保持", vendorCodeSuffix("海邦商事<br>商品コード:t002-2542") === "<br>商品コード:t002-2542");
check("vendorCodeSuffix: 無ければ空", vendorCodeSuffix("Nike") === "");
check("buildExpectedVendor: メーカー名だけ差し替え", buildExpectedVendor("海邦商事<br>商品コード:t002-2542", "新海邦") === "新海邦<br>商品コード:t002-2542");

// ---- 2) parseShopifyItem ----
const parsed = parseShopifyItem(snap);
check("parse: display_name", parsed.display_name === "黒糖しょうがぱうだー 200g");
check("parse: description_pc は imgList 除去済み", parsed.description_pc === addTableClass(DESC));
check("parse: tax_rate はタグから 8", parsed.tax_rate === 8);
check("parse: selling_price 税抜 500", parsed.selling_price === 500);
check("parse: jan_code = barcode", parsed.jan_code === "4955028002542");
check("parse: ne_code = 先頭SKU", parsed.ne_code === "t002-2542-1");
check("parse: maker_name は Vendor から復元", parsed.maker_name === "海邦商事");
check("parse: 先頭SKUの compareAtPrice 無し → display_price 未設定", parsed.display_price === undefined);
check("parse: variants 2件", parsed.variants?.length === 2);
check("parse: variant2 税抜 1300", parsed.variants?.[1]?.selling_price === 1300);
check("parse: variant2 display_price は compareAtPrice の税抜 2000", parsed.variants?.[1]?.display_price === 2000);
check("parse: variant1 display_price 未設定(compareAtPrice null)", parsed.variants?.[0]?.display_price === undefined);
check("parse: variant2 送料無料(タイトル由来)", parsed.variants?.[1]?.shipping_type === "送料無料");
check("parse: variation_value 保持", parsed.variants?.[1]?.variation_value === "3袋セット(送料無料)");

// ---- 2b) _shopifyMeta（対応列が無い項目の構造化保持 — 破棄しない） ----
const meta = parsed._shopifyMeta;
check("meta: 構造体が返る", !!meta);
check("meta: status", meta?.status === "ACTIVE");
check("meta: handle", meta?.handle === "t002-2542");
check("meta: productType", meta?.productType === "食品");
check("meta: seo.title / seo.description", meta?.seo?.title === SEO_TITLE && meta?.seo?.description === SEO_DESC);
check("meta: tags 全量保持", JSON.stringify(meta?.tags) === JSON.stringify(["海邦商事", "税率8%", "ギフト対応"]));
check("meta: variant taxable / inventoryQuantity", meta?.variants?.[0]?.taxable === true && meta?.variants?.[0]?.inventoryQuantity === 25);
check("meta: variant inventoryItemId / tracked", meta?.variants?.[0]?.inventoryItemId === "gid://shopify/InventoryItem/911" && meta?.variants?.[0]?.tracked === true);
check("meta: variant cost（取得できない場合は null で続行）", meta?.variants?.[0]?.cost === "300.0" && meta?.variants?.[1]?.cost === null);

// ---- 3) 往復無差分（幻差分ゼロが部分更新の前提。拡張項目込み） ----
const plan0 = buildShopifyPatchPlan(appProduct(), snap);
check("no-diff: changed 0件", plan0.changed.length === 0, JSON.stringify(plan0.changed));
check("no-diff: productUpdateInput null", plan0.productUpdateInput === null);
check("no-diff: variantsInput 0件", plan0.variantsInput.length === 0);
// maker_name / overrides 未設定の商品でも幻差分を出さない（既存商品の後方互換）
const planLegacy = buildShopifyPatchPlan(appProduct({ maker_name: "", shopify_overrides: {} }), snap);
check("no-diff: maker_name/overrides 未設定でも changed 0件", planLegacy.changed.length === 0, JSON.stringify(planLegacy.changed));

// ---- 4) 価格のみ変更（SKU2 を 1300→1500 税抜 → 1620 税込） ----
const plan1 = buildShopifyPatchPlan(appProduct({}, [{}, { selling_price: 1500 }]), snap);
check("価格変更: changed 1件", plan1.changed.length === 1, JSON.stringify(plan1.changed));
check("価格変更: variant gid 指定 + price のみ", JSON.stringify(plan1.variantsInput) === JSON.stringify([{ id: "gid://shopify/ProductVariant/222", price: "1620" }]));
check("価格変更: productUpdate 側は送らない", plan1.productUpdateInput === null);

// ---- 5) 商品名 + 説明文変更 ----
const NEW_DESC = "<p>リニューアル</p>";
const plan2 = buildShopifyPatchPlan(appProduct({ display_name: "新商品名", description_pc: NEW_DESC }), snap);
check("title 変更検出", plan2.productUpdateInput?.title === "新商品名");
check("body: imgList ブロックを保持して本文差し替え", plan2.productUpdateInput?.descriptionHtml === `${IMG_BLOCK}\n${NEW_DESC}`);
check("body: variantsInput は空のまま", plan2.variantsInput.length === 0);
check("buildExpectedBodyHtml: ブロック無し snapshot は本文のみ", buildExpectedBodyHtml("<p>old</p>", NEW_DESC) === NEW_DESC);

// ---- 6) JAN(barcode) 変更・13桁未満は送らない ----
const plan3 = buildShopifyPatchPlan(appProduct({}, [{ jan_code: "4900000000001" }, {}]), snap);
check("JAN変更: barcode 送信", JSON.stringify(plan3.variantsInput) === JSON.stringify([{ id: "gid://shopify/ProductVariant/111", barcode: "4900000000001" }]));
const plan4 = buildShopifyPatchPlan(appProduct({}, [{ jan_code: "123" }, {}]), snap);
check("JAN不正(13桁未満): 送らない", plan4.variantsInput.length === 0, JSON.stringify(plan4.variantsInput));

// ---- 7) SKU構成変更の検出 ----
const p5 = appProduct();
p5.variants = [...p5.variants, { ...p5.variants[0], ne_code: "t002-2542-6" }];
const sc1 = detectShopifyStructuralChange(p5.variants, snap);
check("structural: SKU追加検出", sc1.added.length === 1 && sc1.added[0] === "t002-2542-6");
const p6 = appProduct();
p6.variants = [p6.variants[0]];
const sc2 = detectShopifyStructuralChange(p6.variants, snap);
check("structural: SKU削除検出", sc2.removed.length === 1 && sc2.removed[0] === "t002-2542-3");
const sc0 = detectShopifyStructuralChange(appProduct().variants, snap);
check("structural: 一致時は検出なし", sc0.added.length === 0 && sc0.removed.length === 0 && !sc0.emptyKey);

// ---- 8) メーカー名(Vendor) 変更 ----
const planV = buildShopifyPatchPlan(appProduct({ maker_name: "新海邦" }), snap);
check("vendor: メーカー名変更で接尾辞を保持して送信", planV.productUpdateInput?.vendor === "新海邦<br>商品コード:t002-2542");
check("vendor: changed に maker_name", planV.changed.some((c) => c.field === "maker_name"));
// メーカー名変更は tags のメーカータグも連動して差し替わる（アプリ管理タグ）
check("vendor: tags も連動（旧メーカータグ→新、他タグ保持）", JSON.stringify(planV.productUpdateInput?.tags) === JSON.stringify(["新海邦", "税率8%", "ギフト対応"]));

// ---- 9) tags マージ（全置換対策 — アプリ管理外タグの保全） ----
check("tags: buildExpectedTags 税率タグ差し替え", JSON.stringify(buildExpectedTags({ vendor: snap.vendor, tags: snap.tags }, { maker_name: "海邦商事", tax_rate: 10 })) === JSON.stringify(["海邦商事", "税率10%", "ギフト対応"]));
check("tags: maker_name 空なら既存メーカータグに触らない", JSON.stringify(buildExpectedTags({ vendor: snap.vendor, tags: snap.tags }, { maker_name: "", tax_rate: 8 })) === JSON.stringify(["税率8%", "海邦商事", "ギフト対応"]));
check("tags: sameTagSet 順序不問", sameTagSet(["a", "b"], ["b", "a"]) === true);
check("tags: sameTagSet 過不足は不一致", sameTagSet(["a"], ["a", "b"]) === false);
// 順序違いだけの snapshot では幻差分を出さない
const snapShuffled = { ...snap, tags: ["ギフト対応", "税率8%", "海邦商事"] };
const planT0 = buildShopifyPatchPlan(appProduct(), snapShuffled);
check("tags: 順序違いのみは差分にしない", !planT0.changed.some((c) => c.field === "tags"), JSON.stringify(planT0.changed));

// ---- 10) Shopify 固有項目（shopify_overrides: status / productType / SEO） ----
const planS = buildShopifyPatchPlan(appProduct({ shopify_overrides: { status: "DRAFT", product_type: "食品", seo_title: SEO_TITLE, seo_description: SEO_DESC } }), snap);
check("status: override 変更で productUpdate に載る", planS.productUpdateInput?.status === "DRAFT");
check("status: changed に status", planS.changed.some((c) => c.field === "status" && c.before === "ACTIVE" && c.after === "DRAFT"));
const planPT = buildShopifyPatchPlan(appProduct({ shopify_overrides: { status: "ACTIVE", product_type: "調味料", seo_title: SEO_TITLE, seo_description: SEO_DESC } }), snap);
check("productType: override 変更で送信", planPT.productUpdateInput?.productType === "調味料");
check("productType: changed に shopify_product_type", planPT.changed.some((c) => c.field === "shopify_product_type"));
const planSEO = buildShopifyPatchPlan(appProduct({ shopify_overrides: { status: "ACTIVE", product_type: "食品", seo_title: "新SEOタイトル", seo_description: SEO_DESC } }), snap);
check("seo: title だけ変更 → description は既知値で埋めて送信", JSON.stringify(planSEO.productUpdateInput?.seo) === JSON.stringify({ title: "新SEOタイトル", description: SEO_DESC }));
check("seo: changed は seo_title のみ", planSEO.changed.length === 1 && planSEO.changed[0].field === "seo_title");
// overrides 未設定なら Shopify 現状に触らない（現状保持）
const planNoOv = buildShopifyPatchPlan(appProduct({ shopify_overrides: {} }), snap);
check("overrides 未設定: status/SEO は diff 対象外", !planNoOv.changed.some((c) => ["status", "shopify_product_type", "seo_title", "seo_description"].includes(c.field)));

// ---- 11) compareAtPrice（表示価格・二重価格） ----
const planC = buildShopifyPatchPlan(appProduct({}, [{}, { display_price: 2500 }]), snap);
check("表示価格変更: compareAtPrice 税込 2700 を送信", JSON.stringify(planC.variantsInput) === JSON.stringify([{ id: "gid://shopify/ProductVariant/222", compareAtPrice: "2700" }]));
check("表示価格変更: changed に SKU[].表示価格(税込)", planC.changed.some((c) => c.field === "SKU[t002-2542-3].表示価格(税込)"));
// display_price=0（未設定）は送らない・クリアもしない（§8-9 未確認のため解除は対象外）
const planC0 = buildShopifyPatchPlan(appProduct({}, [{}, { display_price: 0 }]), snap);
check("表示価格0: compareAtPrice を送らない", planC0.variantsInput.length === 0, JSON.stringify(planC0.variantsInput));
check("表示価格0: null クリアもしない", !JSON.stringify(planC0.variantsInput).includes("compareAtPrice"));
check("表示価格0: skipped に解除未対応の注記", planC0.skipped.some((s) => s.includes("表示価格")), JSON.stringify(planC0.skipped));
// フラット商品（variants 未設定）は product.display_price に従う
const flatApp = appProduct({ variants: [], display_price: 1000 });
const planCF = buildShopifyPatchPlan(flatApp, snap);
check("表示価格(フラット): product.display_price → SKU1 の compareAtPrice 1080", planCF.variantsInput.some((v) => v.id === "gid://shopify/ProductVariant/111" && v.compareAtPrice === "1080"), JSON.stringify(planCF.variantsInput));

// ---- 12) 在庫クライアント（スコープ不足の可視化 — オフラインはメッセージ変換のみ検証） ----
const denied = inventoryScopeHint("[ACCESS_DENIED] Access denied for inventorySetQuantities field. Required access: `write_inventory` access scope.");
check("在庫: ACCESS_DENIED → スコープ追加の案内メッセージ", typeof denied === "string" && denied.includes("write_inventory") && denied.includes("read_inventory"));
check("在庫: 案内は Dev Dashboard の手順を含む", typeof denied === "string" && denied.includes("Dev Dashboard"));
check("在庫: スコープ以外のエラーは変換しない", inventoryScopeHint("Price must be positive") === null);

console.log(fail === 0 ? "\n=== ALL PASS ===" : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
