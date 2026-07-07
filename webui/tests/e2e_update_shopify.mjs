// Shopify 部分更新の実機E2E（Stage 1: DRAFT テスト商品のみ・顧客影響ゼロ。docs/shopify/08 §7）。
// フロー: productCreate(DRAFT・未公開・vendor/tags/productType/SEO 付き) → SKU設定(inventoryItem.sku) →
//   取得（§1-1〜§1-4 の拡張項目）→ buildShopifyPatchPlan(価格+タイトル+vendor+tags+SEO+compareAtPrice) →
//   productVariantsBulkUpdate + productUpdate → 再取得で「変更の反映」と「未送信項目の保持」
//   （部分更新の核心 §8-10）・「タグマージの保全」を確認 → 実機往復の無差分（幻差分ゼロ）→
//   在庫系（price-updater-6 でスコープ追加済み — 追跡ON/原価/在庫数の実更新と読み戻しを確認）→
//   productDelete で掃除。
// 前提: webui/.env.local に SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET（write_products）。
// 実行: npx tsx tests/e2e_update_shopify.mjs
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }

const { getShopifyConfig, getShopifyAccessToken } = await import("../lib/shopify/auth.ts");
const { getProduct, createDraftProduct, deleteProduct, updateProduct, bulkUpdateVariants } = await import("../lib/shopify/product-client.ts");
const { getLocations, setAvailableQuantities, updateInventoryItem, activateInventory } = await import("../lib/shopify/inventory-client.ts");
const { buildShopifyPatchPlan } = await import("../lib/converters/shopify-patch.ts");
const { parseShopifyItem } = await import("../lib/converters/shopify-item-parser.ts");
const { ProductInputSchema } = await import("../lib/product/schema.ts");

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };
const NE = "zzz-shopify-e2e-9990";
const TITLE0 = "Shopify更新E2E商品(DRAFT・自動削除)";
const VENDOR0 = "テストメーカー<br>商品コード:zzz-9990";
const SEO_T0 = "E2E SEOタイトル";
const SEO_D0 = "E2E SEO説明文（変更しない）";
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const cfg = getShopifyConfig();
if (!cfg) {
  console.log("⏭ SKIP: SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET が webui/.env.local に未設定です。");
  console.log("   Dev Dashboard の custom app（write_products スコープ・レガシーインストールフロー=FALSE）を作成し、設定後に再実行してください。");
  process.exit(2);
}

let gid = "";
async function cleanup() {
  if (!gid) return;
  const del = await deleteProduct(cfg, gid);
  check("後始末: productDelete", del.ok, del.ok ? gid : `${del.message} — 手動削除してください: ${gid}`);
}

try {
  // 0) 認証（実機のトークンは shpat_ プレフィックス。資料01 の shpca_ 記載と相違 — 両対応）
  const token = await getShopifyAccessToken(cfg);
  check("トークン取得(shpat_/shpca_)", typeof token === "string" && /^shp(at|ca)_/.test(token), token.slice(0, 6) + "…");

  // 1) DRAFT テスト商品を作成（実機の productCreate 既定は ACTIVE のため DRAFT を明示指定 = 顧客影響ゼロ）。
  //    拡張項目（vendor / productType / tags / seo）も付けて作成し、取得・編集の実機対象にする。
  //    「ギフト対応」はアプリ管理外タグ = マージ保全の確認用。
  const created = await createDraftProduct(cfg, {
    title: TITLE0, status: "DRAFT",
    vendor: VENDOR0, productType: "テスト用",
    tags: ["テストメーカー", "税率10%", "ギフト対応"],
    seo: { title: SEO_T0, description: SEO_D0 },
  });
  check("productCreate(DRAFT・拡張項目付き)", created.ok && !!created.gid, created.ok ? created.gid : created.message);
  if (!created.ok) throw new Error("create failed");
  gid = created.gid;

  // 2) 取得の拡張確認（§1-1〜§1-4 の取得可能項目が query に入っている）
  const got0 = await getProduct(cfg, gid);
  check("getProduct: DRAFT で作成された", got0.exists && got0.product.status === "DRAFT", got0.exists ? got0.product.status : got0.message);
  if (!got0.exists) throw new Error("get failed");
  check("取得: vendor", got0.product.vendor === VENDOR0, got0.product.vendor);
  check("取得: productType", got0.product.productType === "テスト用", got0.product.productType);
  check("取得: tags（アプリ管理外タグ含む）", sameSet(got0.product.tags, ["テストメーカー", "税率10%", "ギフト対応"]), JSON.stringify(got0.product.tags));
  check("取得: seo.title / seo.description", got0.product.seo.title === SEO_T0 && got0.product.seo.description === SEO_D0, JSON.stringify(got0.product.seo));
  const v0 = got0.product.variants[0];
  check("初期 variant が1つある", !!v0?.id, v0?.id);
  check("取得: variant.taxable", typeof v0?.taxable === "boolean", String(v0?.taxable));
  check("取得: variant.inventoryQuantity（read_products で参照可）", typeof v0?.inventoryQuantity === "number", String(v0?.inventoryQuantity));
  check("取得: variant.inventoryItem.id（在庫系 mutation の対象ID）", !!v0?.inventoryItem?.id, v0?.inventoryItem?.id);
  // cost(unitCost) はスコープ次第。取れなくても getProduct が落ちないこと自体が上で確認済み — 実測値を記録のみ
  console.log(`ℹ cost(unitCost) 取得結果: ${v0?.inventoryItem?.cost ?? "null（フィールド未取得 = スコープ外でも parse 続行）"}`);

  // 3) 初期 variant に SKU を設定（InventoryItemInput.sku — 公式確認済み経路。docs/shopify/08 §8-3）
  const skuSet = await bulkUpdateVariants(cfg, gid, [{ id: v0.id, inventoryItem: { sku: NE } }]);
  check("SKU設定(inventoryItem.sku)", skuSet.ok, skuSet.ok ? NE : skuSet.message);

  const got1 = await getProduct(cfg, gid);
  const v1 = got1.exists ? got1.product.variants[0] : null;
  check("SKU が反映された", v1?.sku === NE, v1?.sku);

  // 4) parser の拡張確認（vendor→maker_name / _shopifyMeta の構造化保持）
  const parsed1 = parseShopifyItem(got1.product);
  check("parse: maker_name を Vendor から復元", parsed1.maker_name === "テストメーカー", parsed1.maker_name);
  check("parse: _shopifyMeta.status / productType", parsed1._shopifyMeta?.status === "DRAFT" && parsed1._shopifyMeta?.productType === "テスト用");
  check("parse: _shopifyMeta.seo / inventoryItemId", parsed1._shopifyMeta?.seo?.title === SEO_T0 && !!parsed1._shopifyMeta?.variants?.[0]?.inventoryItemId);

  // 5) アプリ商品を模して patch plan を構築
  //    価格: 税抜1000/税率10% → 税込1100。表示価格: 2000 → compareAtPrice 2200。
  //    メーカー名: テストメーカー → 新テストメーカー（vendor 接尾辞保持 + tags 連動マージ）。
  //    overrides: productType / seo_title を変更、status / seo_description は現状値のまま = 差分に出ない。
  const app = ProductInputSchema.parse({
    ne_code: NE, jan_code: "4955028002542", maker_code: "zzz",
    product_type: "単品", quantity: 1,
    product_name: TITLE0, display_name: TITLE0 + "【改】",
    tax_rate: 10, cost_price: 0, selling_price: 1000, display_price: 2000, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "",
    description_pc: got1.product.descriptionHtml || "", // 説明文は変更しない（差分ゼロを維持）
    maker_name: "新テストメーカー",
    shopify_product_id: gid,
    shopify_overrides: { status: "DRAFT", product_type: "テスト用改", seo_title: SEO_T0 + "【改】", seo_description: SEO_D0 },
  });
  const plan = buildShopifyPatchPlan(app, got1.product);
  const wantPrice = plan.variantsInput.some((v) => v.id === v1.id && v.price === "1100");
  check("plan: 価格 1100(税込) を variant gid 宛てに計画", wantPrice, JSON.stringify(plan.variantsInput));
  check("plan: 表示価格 2200(税込) を compareAtPrice に計画", plan.variantsInput.some((v) => v.id === v1.id && v.compareAtPrice === "2200"));
  check("plan: タイトル変更を productUpdate に計画", plan.productUpdateInput?.title === TITLE0 + "【改】", JSON.stringify(plan.productUpdateInput?.title));
  check("plan: barcode(JAN) も計画に含む", plan.variantsInput.some((v) => v.barcode === "4955028002542"));
  check("plan: vendor はメーカー名差し替え + 接尾辞保持", plan.productUpdateInput?.vendor === "新テストメーカー<br>商品コード:zzz-9990", String(plan.productUpdateInput?.vendor));
  check("plan: tags は決定的マージ（旧メーカー除去・他タグ保持・全量送信）", sameSet(plan.productUpdateInput?.tags ?? [], ["新テストメーカー", "税率10%", "ギフト対応"]), JSON.stringify(plan.productUpdateInput?.tags));
  check("plan: productType / seo_title を計画", plan.productUpdateInput?.productType === "テスト用改" && plan.productUpdateInput?.seo?.title === SEO_T0 + "【改】");
  check("plan: status は現状値と同じ → 差分に出ない", !plan.changed.some((c) => c.field === "status"), JSON.stringify(plan.changed.map((c) => c.field)));

  // 6) 送信（価格 → 商品情報 の順。update route と同じ手順）
  const r1 = await bulkUpdateVariants(cfg, gid, plan.variantsInput);
  check("productVariantsBulkUpdate 成功", r1.ok, r1.ok ? "" : r1.message);
  const r2 = await updateProduct(cfg, plan.productUpdateInput);
  check("productUpdate 成功", r2.ok, r2.ok ? "" : r2.message);

  // 7) 再取得で反映確認 + 未送信項目の保持確認（部分更新の核心）
  const got2 = await getProduct(cfg, gid);
  const v2 = got2.exists ? got2.product.variants[0] : null;
  check("価格が 1100 に反映", Number(v2?.price) === 1100, v2?.price);
  check("表示価格(compareAtPrice)が 2200 に反映", Number(v2?.compareAtPrice) === 2200, v2?.compareAtPrice ?? "");
  check("タイトルが反映", got2.exists && got2.product.title === TITLE0 + "【改】", got2.exists ? got2.product.title : "");
  check("barcode が反映", v2?.barcode === "4955028002542", v2?.barcode ?? "");
  check("vendor が反映（接尾辞保持）", got2.exists && got2.product.vendor === "新テストメーカー<br>商品コード:zzz-9990", got2.exists ? got2.product.vendor : "");
  check("tags マージの保全: アプリ管理外タグ「ギフト対応」が残る", got2.exists && got2.product.tags.includes("ギフト対応"), JSON.stringify(got2.exists ? got2.product.tags : []));
  check("tags マージ: 旧メーカータグが除去され新タグに", got2.exists && !got2.product.tags.includes("テストメーカー") && got2.product.tags.includes("新テストメーカー"), JSON.stringify(got2.exists ? got2.product.tags : []));
  check("productType が反映", got2.exists && got2.product.productType === "テスト用改", got2.exists ? got2.product.productType : "");
  check("seo.title が反映", got2.exists && got2.product.seo.title === SEO_T0 + "【改】", got2.exists ? got2.product.seo.title : "");
  check("保持: seo.description は変わらない（既知値で明示上書き）", got2.exists && got2.product.seo.description === SEO_D0, got2.exists ? got2.product.seo.description : "");
  check("保持: SKU は消えていない（価格更新で未送信）", v2?.sku === NE, v2?.sku);
  check("保持: status は DRAFT のまま（同値 override は未送信）", got2.exists && got2.product.status === "DRAFT", got2.exists ? got2.product.status : "");
  check("保持: variant が増減していない", got2.exists && got2.product.variants.length === got1.product.variants.length);

  // 8) 実機往復の無差分（幻差分ゼロ）: 反映後の実機商品を取込み → 同じ値で plan を組むと差分 0 件
  const parsed2 = parseShopifyItem(got2.product);
  const { _shopifyMeta: meta2, variants: _v2s, ...flat2 } = parsed2;
  void _v2s; // variants[] はフラット取込（fetch route と同じ流儀）のため除外
  const app2 = ProductInputSchema.parse({
    product_type: "単品", quantity: 1, cost_price: 0, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "",
    ...flat2,
    ne_code: NE, maker_code: "zzz", product_name: TITLE0,
    shopify_product_id: gid,
    shopify_overrides: {
      status: meta2?.status, product_type: meta2?.productType,
      seo_title: meta2?.seo?.title, seo_description: meta2?.seo?.description,
    },
  });
  const plan2 = buildShopifyPatchPlan(app2, got2.product);
  check("実機往復: 取込→plan で changed 0件（幻差分ゼロ）", plan2.changed.length === 0, JSON.stringify(plan2.changed));

  // 9) 価格のみ再変更 → タイトルが保持されること（逆方向の保持確認）
  const r3 = await bulkUpdateVariants(cfg, gid, [{ id: v1.id, price: "1234" }]);
  check("価格のみ再更新 成功", r3.ok, r3.ok ? "" : r3.message);
  const got3 = await getProduct(cfg, gid);
  check("価格 1234 に反映", got3.exists && Number(got3.product.variants[0]?.price) === 1234, got3.exists ? got3.product.variants[0]?.price : "");
  check("保持: タイトルは変わらない（価格のみ送信）", got3.exists && got3.product.title === TITLE0 + "【改】");

  // 10) 在庫系の実動作確認（price-updater-6 で write_inventory / read_inventory / read_locations 追加済み）。
  //     追跡ON+原価 → ロケーション取得 → 在庫数の絶対値設定（未ストックなら inventoryActivate）→ 読み戻し。
  //     対象は DRAFT テスト商品のみ（実在庫への影響なし・最後に削除）。
  const invItemId = v2?.inventoryItem?.id ?? "";
  const costR = await updateInventoryItem(cfg, invItemId, { cost: "500", tracked: true });
  check("在庫: inventoryItemUpdate(tracked+原価500) 成功", costR.ok, costR.ok ? "" : costR.message);
  const locR = await getLocations(cfg);
  check("在庫: locations 取得成功", locR.ok && locR.locations.length > 0, locR.ok ? `${locR.locations.length}件 (${locR.locations[0]?.name})` : locR.message);
  const locId = locR.ok && locR.locations.length > 0 ? (locR.locations.find((l) => l.isActive) ?? locR.locations[0]).id : "";
  let setR = { ok: false, message: "ロケーション未取得のためスキップ", needsScope: false };
  if (locId) {
    setR = await setAvailableQuantities(cfg, [{ inventoryItemId: invItemId, locationId: locId, quantity: 7 }]);
    if (!setR.ok && /not stocked/i.test(setR.message)) {
      // 未ストックのロケーション → inventoryActivate で有効化 + 初期在庫を設定（docs/shopify/06 §2）
      setR = await activateInventory(cfg, invItemId, locId, 7);
      check("在庫: 未ストックのため inventoryActivate 経由", setR.ok, setR.ok ? "" : setR.message);
    }
  }
  check("在庫: 在庫数7の絶対値設定 成功", setR.ok, setR.ok ? "" : setR.message);
  await new Promise((r) => setTimeout(r, 1500)); // 反映待ち（在庫は集計に僅かな遅延がある）
  const got4 = await getProduct(cfg, gid);
  const v4 = got4.exists ? got4.product.variants[0] : null;
  check("在庫: inventoryQuantity=7 を読み戻し", v4?.inventoryQuantity === 7, String(v4?.inventoryQuantity));
  check("在庫: 原価500を読み戻し（unitCost もスコープで取得可能に）", Number(v4?.inventoryItem?.cost) === 500, v4?.inventoryItem?.cost ?? "null");
  check("在庫: tracked=true を読み戻し", v4?.inventoryItem?.tracked === true, String(v4?.inventoryItem?.tracked));
} catch (e) {
  fail++;
  console.log("❌ 例外: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await cleanup();
}

console.log(fail === 0 ? "\n=== ALL PASS ===" : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
