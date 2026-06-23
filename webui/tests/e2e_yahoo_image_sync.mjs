// 取込画像 → Yahoo lib 転送のE2E。image_url_1(R-Cabinet実URL)をYahoo libへ転送し、その後Yahoo登録が通ることを検証。
//   DB商品(image_url_1=R-Cabinet実URL)作成 → yahoo-sync(転送) → register(editItem,display0)成功(it-14091出ない)
//   → deleteItem + deleteLibImage + DB削除。
// 前提: dev server が http://localhost:3000。実行: npx tsx tests/e2e_yahoo_image_sync.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { deleteItem } from "../lib/yahoo/item-client.ts";
import { deleteLibImage } from "../lib/yahoo/lib-image-client.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-ysync-9988";
// 転送元: 実在する公開R-Cabinet画像(取込商品の image_url 相当)。
const SRC = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/newima/shohin03/5707196114669.jpg";

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cfg = getYahooConfig();
  const token = await getYahooAccessToken(cfg);
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  try { await deleteItem(token, cfg.sellerId, NE); } catch { /* noop */ }
  try { await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`); } catch { /* noop */ }

  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028002542", maker_code: "zzz",
    product_type: "単品", quantity: 1, product_name: "Yahoo画像転送E2E", display_name: "Yahoo画像転送E2E商品",
    tax_rate: 10, cost_price: 0, selling_price: 1000, shipping_type: "送料別",
    image_count: 1, delivery_method: 1, lead_time: 1, mall_category_id: "0",
    yahoo_category_id: "13457", yahoo_path: "テスト", yahoo_grouping_enabled: false,
    catch_copy_yahoo: "転送テスト", description_pc: "<p>転送テスト</p>",
    extra: { image_url_1: SRC },  // 取込んだ実画像URL(R-Cabinet)を保持している状態を再現
  }).select("id").single()).data;
  check("テスト商品作成(image_url_1=R-Cabinet実URL)", !!prod?.id, prod && prod.id.slice(0, 8));

  // セッション
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) yahoo-sync: 取込画像URLをYahoo libへ転送
  const sy = await fetch(`${BASE}/api/upload/yahoo-sync/${prod.id}`, { method: "POST", headers: H });
  const syj = await sy.json();
  check("yahoo-sync 200(転送成功)", sy.status === 200 && syj.ok, `HTTP ${sy.status} ${JSON.stringify(syj).slice(0, 200)}`);
  check("転送ファイル=NEコード.jpg", syj.uploaded?.[0]?.fileName === `${NE}.jpg`, JSON.stringify(syj.uploaded));
  await sleep(2000);

  // 2) register(editItem,display0): 画像が揃ったので it-14091 が出ず成功するはず
  const reg = await fetch(`${BASE}/api/register/yahoo/${prod.id}`, { method: "POST", headers: H, body: JSON.stringify({ forceDisplay: "0" }) });
  const regj = await reg.json();
  check("★Yahoo登録 成功(it-14091解消)", reg.status === 200 && regj.ok, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 200)}`);
  await sleep(1500);

  // 3) 後始末
  const del = await deleteItem(token, cfg.sellerId, NE);
  check("deleteItem 後始末", del.ok, del.message);
  const delImg = await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`);
  check("deleteLibImage 後始末", delImg.ok, delImg.message);
  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 取込画像→Yahoo lib転送 E2E 成功（転送後にYahoo登録が通る）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
