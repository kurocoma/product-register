// Yahoo 商品コード取込(要件①)のE2E。実フロー: 画像up→register(モールに作成)→DB削除→import(コードで取込→新規作成)→検証→後始末。
//   画像up → register POST(editItem, display=0) → 元DB商品を削除 → import POST {code} → 作成商品を検証
//   → 再import で existed:true(重複作成しない) → deleteItem + 画像削除 + DB削除。
// 前提: dev server が http://localhost:3000 で起動していること。
// 実行: npx tsx tests/e2e_import_yahoo.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { deleteItem } from "../lib/yahoo/item-client.ts";
import { uploadLibImage, deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { dbRowToProductInput } from "../lib/product/repository.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-impy-9989";    // itemCode(=取込後の NEコード)
const PRICE = 1280;
const NAME = "Yahoo取込E2E商品";

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cfg = getYahooConfig();
  const token = await getYahooAccessToken(cfg);
  // 後始末（前回残骸）
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  try { await deleteItem(token, cfg.sellerId, NE); } catch { /* noop */ }
  try { await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`); } catch { /* noop */ }

  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028002542", maker_code: "zzz",
    product_type: "単品", quantity: 1, product_name: NAME, display_name: NAME,
    tax_rate: 10, cost_price: 0, selling_price: PRICE, shipping_type: "送料別",
    image_count: 1, delivery_method: 1, lead_time: 1, mall_category_id: "0",
    yahoo_category_id: "13457", yahoo_path: "テスト", yahoo_grouping_enabled: false,
    catch_copy_yahoo: "取込キャッチ", description_pc: "<p>取込キャプ</p>", extra: {},
  }).select("id").single()).data;
  check("セットアップ用DB商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  // 画像アップロード（editItem の item_image_urls 参照先）
  const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg().toBuffer();
  const upImg = await uploadLibImage(token, cfg.sellerId, { fileName: `${NE}.jpg`, jpeg });
  check("lib画像アップロード", upImg.ok, upImg.ok ? "" : upImg.message);
  await sleep(1500);

  // セッション（magic-link）
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) register POST（display=0 非公開でモールに作成）
  const reg = await fetch(`${BASE}/api/register/yahoo/${prod.id}`, { method: "POST", headers: H, body: JSON.stringify({ forceDisplay: "0" }) });
  const regj = await reg.json();
  check("register POST 200(モールに作成)", reg.status === 200 && regj.ok, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 160)}`);
  await sleep(2500);

  // 2) 元DB商品を削除（import が「新規作成」することを保証する）
  await admin.from("products").delete().eq("id", prod.id);
  const { data: gone } = await admin.from("products").select("id").eq("id", prod.id).maybeSingle();
  check("セットアップ用DB商品を削除", !gone, "import は新規作成パスを通る");

  // 3) import POST {code} — 商品コードで取込んで新規作成
  const imp = await fetch(`${BASE}/api/import/yahoo`, { method: "POST", headers: H, body: JSON.stringify({ code: NE }) });
  const impj = await imp.json();
  check("import POST 200", imp.status === 200 && impj.ok, `HTTP ${imp.status} ${JSON.stringify(impj).slice(0, 200)}`);
  check("existed=false(新規作成)", impj.existed === false, JSON.stringify(impj));
  check("productId 採番", !!impj.productId && impj.productId !== prod.id, impj.productId && impj.productId.slice(0, 8));
  check("返却 neCode 一致", impj.neCode === NE, impj.neCode);
  const createdId = impj.productId;

  // 4) 作成された商品を検証
  const { data: row } = await admin.from("products").select("*").eq("id", createdId).single();
  let product = null;
  try { product = dbRowToProductInput(row); check("dbRowToProductInput 成功(編集画面が壊れない)", true, ""); }
  catch (e) { check("dbRowToProductInput 成功(編集画面が壊れない)", false, String(e).slice(0, 160)); }
  // 仕様変更(selling_price 全モール税抜統一): Yahoo の Price は「税込」で返るため、取込時に
  // parseYahooItem が税抜へ変換して保存する（register 送信の税込化と対称）。
  // register が送った税込 1408(=1280×1.1) → 取込で税抜 1280 に戻る（往復安定）。
  // 旧仕様（税込 Price を 1:1 で selling_price へ）の期待値 1408 は本仕様変更で陳腐化したため更新。
  const EXPECT_IMPORTED_PRICE = PRICE; // 1280（税抜）
  if (product) {
    check("ne_code 一致", product.ne_code === NE, product.ne_code);
    check("jan_code は13桁", /^\d{13}$/.test(product.jan_code), product.jan_code);
    check("selling_price 取込一致(税抜へ変換・登録時の値へ往復)", product.selling_price === EXPECT_IMPORTED_PRICE, `${product.selling_price} (期待 ${EXPECT_IMPORTED_PRICE})`);
    check("tax_rate=10 取込(getItem TaxrateType 由来)", product.tax_rate === 10, String(product.tax_rate));
    check("display_price=0(二重価格なし→販売価格連動へ正規化)", (product.display_price ?? 0) === 0, String(product.display_price));
    check("display_name 取込一致", product.display_name === NAME, product.display_name);
    check("yahoo_category_id 取込一致", product.yahoo_category_id === "13457", product.yahoo_category_id);
  }

  // 5) 再度 import → 重複作成せず existed:true で同一商品を返す
  const imp2 = await fetch(`${BASE}/api/import/yahoo`, { method: "POST", headers: H, body: JSON.stringify({ code: NE }) });
  const imp2j = await imp2.json();
  check("再import existed:true(重複作成しない)", imp2.status === 200 && imp2j.ok && imp2j.existed === true && imp2j.productId === createdId, JSON.stringify(imp2j).slice(0, 160));

  // 6) 後始末
  await sleep(800);
  const del = await deleteItem(token, cfg.sellerId, NE);
  check("deleteItem 後始末", del.ok, del.message);
  await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`);
  await admin.from("products").delete().eq("id", createdId);
  check("作成商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 Yahoo 商品コード取込 E2E 成功（register→import新規作成→検証）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
