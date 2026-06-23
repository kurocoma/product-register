// 楽天 管理番号取込(要件①)のE2E。実フロー: register(モールに作成)→DB削除→import(管理番号で取込→新規作成)→検証→後始末。
//   DB商品作成 → register POST(モールに zzv-2542 作成,倉庫非公開) → 元DB商品を削除(import が新規作成することを保証)
//   → import POST {code:"zzv-2542"} → 作成された商品を検証(dbRowToProductInput 成功・ne_code・baseCode 再現・価格/表示名)
//   → 再度 import で existed:true(重複作成しない)を確認 → items.delete + DB削除。
// 前提: dev server が http://localhost:3000 で起動していること。
// 実行: npx tsx tests/e2e_import_rakuten.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { deleteItem } from "../lib/rakuten/item-client.ts";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import { buildRakutenManageNumber } from "../lib/converters/rakuten-api.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-imp-1";        // variant 管理番号(=取込後の NEコード)
const JAN = "4955028002542";    // 13桁(末尾2542)
const MAKER = "zzv";
const MN = "zzv-2542";          // baseCodeOf(maker=zzv, jan末尾2542) = 入力する商品管理番号
const PRICE = 2580;
const NAME = "楽天取込E2E商品";

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cred = getRakutenCredentialsFromEnv();
  // 後始末（前回の残骸）
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  try { await deleteItem(cred, MN); } catch { /* noop */ }

  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: JAN, maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: NAME, display_name: NAME,
    tax_rate: 10, cost_price: 0, selling_price: PRICE, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "取込キャッチ", description_pc: "<p>取込PC</p>", description_sp: "<p>取込SP</p>",
    extra: { attributes: [
      { item: "メーカー型番", value: "IMP-001", unit: "", requirement: "必須" },
      { item: "タイトル", value: "取込テスト", unit: "", requirement: "必須" },
      { item: "発売元", value: "テスト", unit: "", requirement: "必須" },
    ] },
  }).select("id").single()).data;
  check("セットアップ用DB商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  // セッション（magic-link）
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) register POST（モールに zzv-2542 を倉庫・非公開で作成）
  const reg = await fetch(`${BASE}/api/register/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const regj = await reg.json();
  check("register POST 200(モールに作成)", reg.status === 200 && regj.ok, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 160)}`);
  await sleep(2000);

  // 2) 元DB商品を削除（import が「新規作成」することを保証する）
  await admin.from("products").delete().eq("id", prod.id);
  const { data: gone } = await admin.from("products").select("id").eq("id", prod.id).maybeSingle();
  check("セットアップ用DB商品を削除", !gone, "import は新規作成パスを通る");

  // 3) import POST {code} — 管理番号で取込んで新規作成
  const imp = await fetch(`${BASE}/api/import/rakuten`, { method: "POST", headers: H, body: JSON.stringify({ code: MN }) });
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
  if (product) {
    check("ne_code 一致", product.ne_code === NE, product.ne_code);
    check("jan_code は13桁", /^\d{13}$/.test(product.jan_code), product.jan_code);
    check("buildRakutenManageNumber が入力コードを再現", buildRakutenManageNumber(product) === MN, buildRakutenManageNumber(product));
    check("selling_price 取込一致", product.selling_price === PRICE, String(product.selling_price));
    check("display_name 取込一致", product.display_name === NAME, product.display_name);
    check("mall_category_id 取込一致", product.mall_category_id === "553575", product.mall_category_id);
    // 画像: getItem の images[].location → 実画像URL(image_url_1) + image_count に取り込まれる
    check("image_count 取込一致", product.image_count === 1, String(product.image_count));
    check("image_url_1 = 実画像の公開URL", product.image_url_1 === `https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/${NE}.jpg`, product.image_url_1);
    // システム連携用SKU番号(register が ne_code を書込)→ 取込時に NEコードとして読まれる
    check("ne_code = merchantDefinedSkuId(=登録時のNEコード)", product.ne_code === NE, product.ne_code);
  }

  // 5) 再度 import → 重複作成せず existed:true で同一商品を返す
  const imp2 = await fetch(`${BASE}/api/import/rakuten`, { method: "POST", headers: H, body: JSON.stringify({ code: MN }) });
  const imp2j = await imp2.json();
  check("再import existed:true(重複作成しない)", imp2.status === 200 && imp2j.ok && imp2j.existed === true && imp2j.productId === createdId, JSON.stringify(imp2j).slice(0, 160));

  // 6) 後始末
  await sleep(800);
  const del = await deleteItem(cred, MN);
  check("items.delete 後始末", del.ok, `status=${del.status}`);
  await admin.from("products").delete().eq("id", createdId);
  check("作成商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 楽天 管理番号取込 E2E 成功（register→import新規作成→検証）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
