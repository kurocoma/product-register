// Shopify 部分更新の実機E2E（Stage 1: DRAFT テスト商品のみ・顧客影響ゼロ。docs/shopify/08 §7）。
// フロー: productCreate(DRAFT・未公開) → SKU設定(inventoryItem.sku) → 取得 →
//   buildShopifyPatchPlan(価格+タイトル変更) → productVariantsBulkUpdate + productUpdate →
//   再取得で「変更の反映」と「未送信項目の保持」（部分更新の核心 §8-10）を確認 → productDelete で掃除。
// 前提: webui/.env.local に SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET（write_products）。
// 実行: npx tsx tests/e2e_update_shopify.mjs
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }

const { getShopifyConfig, getShopifyAccessToken } = await import("../lib/shopify/auth.ts");
const { getProduct, createDraftProduct, deleteProduct, updateProduct, bulkUpdateVariants } = await import("../lib/shopify/product-client.ts");
const { buildShopifyPatchPlan } = await import("../lib/converters/shopify-patch.ts");
const { ProductInputSchema } = await import("../lib/product/schema.ts");

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };
const NE = "zzz-shopify-e2e-9990";
const TITLE0 = "Shopify更新E2E商品(DRAFT・自動削除)";

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

  // 1) DRAFT テスト商品を作成（実機の productCreate 既定は ACTIVE のため DRAFT を明示指定 = 顧客影響ゼロ）
  const created = await createDraftProduct(cfg, { title: TITLE0, status: "DRAFT" });
  check("productCreate(DRAFT)", created.ok && !!created.gid, created.ok ? created.gid : created.message);
  if (!created.ok) throw new Error("create failed");
  gid = created.gid;

  const got0 = await getProduct(cfg, gid);
  check("getProduct: DRAFT で作成された", got0.exists && got0.product.status === "DRAFT", got0.exists ? got0.product.status : got0.message);
  if (!got0.exists) throw new Error("get failed");
  const v0 = got0.product.variants[0];
  check("初期 variant が1つある", !!v0?.id, v0?.id);

  // 2) 初期 variant に SKU を設定（InventoryItemInput.sku — 公式確認済み経路。docs/shopify/08 §8-3）
  const skuSet = await bulkUpdateVariants(cfg, gid, [{ id: v0.id, inventoryItem: { sku: NE } }]);
  check("SKU設定(inventoryItem.sku)", skuSet.ok, skuSet.ok ? NE : skuSet.message);

  const got1 = await getProduct(cfg, gid);
  const v1 = got1.exists ? got1.product.variants[0] : null;
  check("SKU が反映された", v1?.sku === NE, v1?.sku);
  const priceBefore = v1?.price;

  // 3) アプリ商品を模して patch plan を構築（税抜1000/税率10% → 税込1100 + タイトル変更）
  const app = ProductInputSchema.parse({
    ne_code: NE, jan_code: "4955028002542", maker_code: "zzz",
    product_type: "単品", quantity: 1,
    product_name: TITLE0, display_name: TITLE0 + "【改】",
    tax_rate: 10, cost_price: 0, selling_price: 1000, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "",
    description_pc: got1.product.descriptionHtml || "", // 説明文は変更しない（差分ゼロを維持）
    shopify_product_id: gid,
  });
  const plan = buildShopifyPatchPlan(app, got1.product);
  const wantPrice = plan.variantsInput.some((v) => v.id === v1.id && v.price === "1100");
  check("plan: 価格 1100(税込) を variant gid 宛てに計画", wantPrice, JSON.stringify(plan.variantsInput));
  check("plan: タイトル変更を productUpdate に計画", plan.productUpdateInput?.title === TITLE0 + "【改】", JSON.stringify(plan.productUpdateInput));
  check("plan: barcode(JAN) も計画に含む", plan.variantsInput.some((v) => v.barcode === "4955028002542"));

  // 4) 送信（価格 → 商品情報 の順。update route と同じ手順）
  const r1 = await bulkUpdateVariants(cfg, gid, plan.variantsInput);
  check("productVariantsBulkUpdate 成功", r1.ok, r1.ok ? "" : r1.message);
  const r2 = await updateProduct(cfg, plan.productUpdateInput);
  check("productUpdate 成功", r2.ok, r2.ok ? "" : r2.message);

  // 5) 再取得で反映確認 + 未送信項目の保持確認（部分更新の核心）
  const got2 = await getProduct(cfg, gid);
  const v2 = got2.exists ? got2.product.variants[0] : null;
  check("価格が 1100 に反映", Number(v2?.price) === 1100, v2?.price);
  check("タイトルが反映", got2.exists && got2.product.title === TITLE0 + "【改】", got2.exists ? got2.product.title : "");
  check("barcode が反映", v2?.barcode === "4955028002542", v2?.barcode ?? "");
  check("保持: SKU は消えていない（価格更新で未送信）", v2?.sku === NE, v2?.sku);
  check("保持: status は DRAFT のまま（productUpdate で未送信）", got2.exists && got2.product.status === "DRAFT", got2.exists ? got2.product.status : "");
  check("保持: variant が増減していない", got2.exists && got2.product.variants.length === got1.product.variants.length);

  // 6) 価格のみ再変更 → タイトルが保持されること（逆方向の保持確認）
  const r3 = await bulkUpdateVariants(cfg, gid, [{ id: v1.id, price: "1234" }]);
  check("価格のみ再更新 成功", r3.ok, r3.ok ? "" : r3.message);
  const got3 = await getProduct(cfg, gid);
  check("価格 1234 に反映", got3.exists && Number(got3.product.variants[0]?.price) === 1234, got3.exists ? got3.product.variants[0]?.price : "");
  check("保持: タイトルは変わらない（価格のみ送信）", got3.exists && got3.product.title === TITLE0 + "【改】");
  void priceBefore;
} catch (e) {
  fail++;
  console.log("❌ 例外: " + (e instanceof Error ? e.message : String(e)));
} finally {
  await cleanup();
}

console.log(fail === 0 ? "\n=== ALL PASS ===" : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
