// Shopify parser / patch のオフライン検証（API 呼び出しなし・fixture のみ）。
// 実行: npx tsx tests/verify_shopify_patch.mjs
import { ProductInputSchema } from "../lib/product/schema.ts";
import { addTableClass } from "../lib/converters/shopify.ts";
import {
  parseShopifyItem, stripImgList, extractImgList, taxRateFromTags, taxExcludedPrice,
} from "../lib/converters/shopify-item-parser.ts";
import {
  buildShopifyPatchPlan, detectShopifyStructuralChange, buildExpectedBodyHtml,
} from "../lib/converters/shopify-patch.ts";
import { toProductGid, gidToNumericId } from "../lib/shopify/product-client.ts";

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// ---- fixture: 本アプリ CSV 規約で登録された想定の Shopify 商品（税率8%・2SKU） ----
const DESC = '<p>黒糖しょうがぱうだー</p><table border="1"><tr><td>内容量</td><td>200g</td></tr></table>';
const IMG_BLOCK = '<!--imgList--><img src="https://cdn.shopify.com/s/files/1/x/files/t002-2542_2.jpg" width="100%"><br><!--/imgList-->';
const BODY = `${IMG_BLOCK}\n${addTableClass(DESC)}`;
const snap = {
  id: "gid://shopify/Product/1234567890",
  title: "黒糖しょうがぱうだー 200g",
  descriptionHtml: BODY,
  status: "ACTIVE",
  vendor: "海邦商事<br>商品コード:t002-2542",
  handle: "t002-2542",
  tags: ["海邦商事", "税率8%"],
  variants: [
    { id: "gid://shopify/ProductVariant/111", title: "1袋", sku: "t002-2542-1", price: "540", compareAtPrice: null, barcode: "4955028002542" },
    { id: "gid://shopify/ProductVariant/222", title: "3袋セット(送料無料)", sku: "t002-2542-3", price: "1404", compareAtPrice: null, barcode: "4955028002542" },
  ],
};

// アプリ側の同一商品（selling_price は税抜: 540/1.08=500, 1404/1.08=1300）
const appProduct = (over = {}, variantOver = [{}, {}]) => ProductInputSchema.parse({
  ne_code: "t002-2542-1", jan_code: "4955028002542", maker_code: "t002",
  product_type: "単品", quantity: 1,
  product_name: "黒糖しょうがぱうだー 200g", display_name: "黒糖しょうがぱうだー 200g",
  tax_rate: 8, cost_price: 0, selling_price: 500, shipping_type: "送料別",
  image_count: 2, delivery_method: 4, lead_time: 1, mall_category_id: "",
  description_pc: DESC,
  shopify_product_id: "gid://shopify/Product/1234567890",
  variants: [
    { ne_code: "t002-2542-1", jan_code: "4955028002542", selling_price: 500, tax_rate: 8, quantity: 1, variation_value: "1袋", shipping_type: "送料別", ...variantOver[0] },
    { ne_code: "t002-2542-3", jan_code: "4955028002542", selling_price: 1300, tax_rate: 8, quantity: 3, variation_value: "3袋セット", shipping_type: "送料無料", ...variantOver[1] },
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

// ---- 2) parseShopifyItem ----
const parsed = parseShopifyItem(snap);
check("parse: display_name", parsed.display_name === "黒糖しょうがぱうだー 200g");
check("parse: description_pc は imgList 除去済み", parsed.description_pc === addTableClass(DESC));
check("parse: tax_rate はタグから 8", parsed.tax_rate === 8);
check("parse: selling_price 税抜 500", parsed.selling_price === 500);
check("parse: jan_code = barcode", parsed.jan_code === "4955028002542");
check("parse: ne_code = 先頭SKU", parsed.ne_code === "t002-2542-1");
check("parse: variants 2件", parsed.variants?.length === 2);
check("parse: variant2 税抜 1300", parsed.variants?.[1]?.selling_price === 1300);
check("parse: variant2 送料無料(タイトル由来)", parsed.variants?.[1]?.shipping_type === "送料無料");
check("parse: variation_value 保持", parsed.variants?.[1]?.variation_value === "3袋セット(送料無料)");

// ---- 3) 往復無差分（幻差分ゼロが部分更新の前提） ----
const plan0 = buildShopifyPatchPlan(appProduct(), snap);
check("no-diff: changed 0件", plan0.changed.length === 0, JSON.stringify(plan0.changed));
check("no-diff: productUpdateInput null", plan0.productUpdateInput === null);
check("no-diff: variantsInput 0件", plan0.variantsInput.length === 0);

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

console.log(fail === 0 ? "\n=== ALL PASS ===" : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
