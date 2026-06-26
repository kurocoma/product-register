// 多SKU 楽天 register→patch ラウンドトリップ E2E（実API、安全なhideItem=倉庫商品）。
//   2SKU(zzv-sku-a/zzv-sku-b)をupsert登録→items.getで両SKU確認→skuAのみ価格変更→
//   update(dry-run+patch)で「変わったSKUだけ」更新を確認→items.delete後始末。
// 実行: npx tsx tests/e2e_multisku_rakuten.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, deleteItem } from "../lib/rakuten/item-client.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const MAKER = "zzv", JAN = "4955028009995", MN = "zzv-9995"; // baseCodeOf = maker-jan下4
const SKU_A = "zzv-sku-a", SKU_B = "zzv-sku-b";
const ATTRS = [
  { item: "メーカー型番", value: "TEST-MS", unit: "", requirement: "必須" },
  { item: "タイトル", value: "多SKUテスト", unit: "", requirement: "必須" },
  { item: "発売元", value: "テストメーカー", unit: "", requirement: "必須" },
];
const variant = (sku, price, jan, label) => ({
  sku_manage_number: sku, ne_code: sku, jan_code: jan, selling_price: price, tax_rate: 10, quantity: 1,
  variation_value: label, shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "",
  shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: ATTRS,
});

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cred = getRakutenCredentialsFromEnv();
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", SKU_A);
  await deleteItem(cred, MN).catch(() => {});

  // 2SKUの商品をDB作成（variants[] は extra）
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: SKU_A, jan_code: JAN, maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: "多SKU E2E", display_name: "多SKU E2Eテスト商品",
    tax_rate: 10, cost_price: 0, selling_price: 1980, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "テスト", description_pc: "<p>説明</p>", description_sp: "<p>SP</p>",
    extra: { attributes: ATTRS, variants: [variant(SKU_A, 1980, "", "Aタイプ"), variant(SKU_B, 2980, "", "Bタイプ")] },
  }).select("id").single()).data;
  check("テスト商品作成(2SKU)", !!prod?.id, prod && prod.id.slice(0, 8));

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([n, v]) => ({ name: n, value: v })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) 登録(upsert) hideItem=true
  const co = await fetch(`${BASE}/api/register/rakuten/${prod.id}`, { method: "POST", headers: H, body: JSON.stringify({ hideItem: true }) });
  const coj = await co.json();
  check("登録 POST(多variant upsert)", co.status === 200 && coj.ok, `HTTP ${co.status} ${JSON.stringify(coj).slice(0, 200)}`);

  // 2) items.get で両SKU確認
  await sleep(2500);
  const got1 = await getItem(cred, MN);
  const vs1 = got1.json?.variants || {};
  check("items.get 2SKU登録確認", got1.exists && vs1[SKU_A] && vs1[SKU_B], `keys=${Object.keys(vs1).join(",")}`);
  check("skuA価格1980 / skuB価格2980", vs1[SKU_A]?.standardPrice === "1980" && vs1[SKU_B]?.standardPrice === "2980", `A=${vs1[SKU_A]?.standardPrice} B=${vs1[SKU_B]?.standardPrice}`);

  // 3) skuAのみ価格1980→1881に変更（DBのvariants[0]を更新）
  const cur = (await admin.from("products").select("extra").eq("id", prod.id).single()).data.extra;
  cur.variants[0].selling_price = 1881;
  await admin.from("products").update({ extra: cur }).eq("id", prod.id);

  // 4) 反映 dry-run(GET): skuAだけ差分・bodyにzzv-sku-aのみ
  const dr = await fetch(`${BASE}/api/update/rakuten/${prod.id}`, { headers: { Cookie: cookie } });
  const drj = await dr.json();
  const willKeys = Object.keys(drj.willSend?.variants || {});
  check("dry-run: skuAのみ差分検出", drj.changedFields?.some((c) => c.field === `SKU[${SKU_A}].販売価格`) && willKeys.length === 1 && willKeys[0] === SKU_A, `changed=${JSON.stringify(drj.changedFields)} willKeys=${willKeys}`);
  check("dry-run: 送信価格1881", drj.willSend?.variants?.[SKU_A]?.standardPrice === "1881", JSON.stringify(drj.willSend?.variants));

  // 5) 反映 commit(POST patch)
  const up = await fetch(`${BASE}/api/update/rakuten/${prod.id}`, { method: "POST", headers: H, body: JSON.stringify({}) });
  const upj = await up.json();
  check("反映 POST(多variant patch)", up.status === 200 && upj.ok, `HTTP ${up.status} ${JSON.stringify(upj).slice(0, 160)}`);

  // 6) items.get: skuA=1881, skuB=2980(不変)
  await sleep(2500);
  const got2 = await getItem(cred, MN);
  const vs2 = got2.json?.variants || {};
  check("patch後 skuA=1881", vs2[SKU_A]?.standardPrice === "1881", vs2[SKU_A]?.standardPrice);
  check("patch後 skuB=2980(不変)", vs2[SKU_B]?.standardPrice === "2980", vs2[SKU_B]?.standardPrice);

  // 7) 後始末
  await sleep(1000);
  const del = await deleteItem(cred, MN);
  check("items.delete 後始末", del.ok, `status=${del.status}`);
  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 多SKU 楽天 register→patch E2E 成功（2SKU登録→片SKU値上げ→該当SKUのみpatch→確認→削除）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
