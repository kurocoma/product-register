// Yahoo 既存商品編集(部分更新)のE2E。実フロー: register(作成)→fetch(取込)→価格変更→update(ラウンドトリップ反映)。
//   画像up → register POST(editItem) → fetch POST(取込) → DBで価格1000→2480 → update GET(diff=価格のみ)
//   → update POST(editItem) → getItem(価格2480・headline/caption/display保持) → deleteItem + 画像削除 + DB削除。
// 前提: dev server が http://localhost:3000 で起動していること。
// 実行: npx tsx tests/e2e_update_yahoo.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { getItem, deleteItem } from "../lib/yahoo/item-client.ts";
import { uploadLibImage, deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { parseYahooItem } from "../lib/converters/yahoo-item-parser.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-updy-9990";

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
    product_type: "単品", quantity: 1, product_name: "Yahoo更新E2E", display_name: "Yahoo更新E2E商品",
    tax_rate: 10, cost_price: 0, selling_price: 1000, shipping_type: "送料別",
    image_count: 1, delivery_method: 1, lead_time: 1, mall_category_id: "0",
    yahoo_category_id: "13457", yahoo_path: "テスト", yahoo_grouping_enabled: false,
    catch_copy_yahoo: "初期キャッチ", description_pc: "<p>初期キャプ</p>", extra: {},
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  // 画像アップロード（editItem の item_image_urls 参照先）
  const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 60, g: 140, b: 200 } } }).jpeg().toBuffer();
  const upImg = await uploadLibImage(token, cfg.sellerId, { fileName: `${NE}.jpg`, jpeg });
  check("lib画像アップロード", upImg.ok, upImg.ok ? "" : upImg.message);
  await sleep(1500);

  // セッション
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) register POST（display=0 非公開で作成、価格1000）
  const reg = await fetch(`${BASE}/api/register/yahoo/${prod.id}`, { method: "POST", headers: H, body: JSON.stringify({ forceDisplay: "0" }) });
  const regj = await reg.json();
  check("register POST 200", reg.status === 200 && regj.ok, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 160)}`);
  await sleep(2500);

  // 2) fetch POST（モール現状をアプリへ取込）
  const fe = await fetch(`${BASE}/api/fetch/yahoo/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const fej = await fe.json();
  check("fetch POST 200(取込)", fe.status === 200 && fej.ok, `HTTP ${fe.status} ${JSON.stringify(fej).slice(0, 160)}`);

  // 3) アプリ側で価格だけ 1000 → 2480
  await admin.from("products").update({ selling_price: 2480 }).eq("id", prod.id);

  // 4) update GET（dry-run）= 差分は selling_price のみ・advanced なし
  const dr = await fetch(`${BASE}/api/update/yahoo/${prod.id}`, { headers: { Cookie: cookie } });
  const drj = await dr.json();
  check("update GET 200", dr.status === 200 && drj.ok, `HTTP ${dr.status}`);
  check("差分は selling_price のみ", drj.hasChanges && drj.changedFields.length === 1 && drj.changedFields[0].field === "selling_price", JSON.stringify(drj.changedFields));
  check("advanced なし", Array.isArray(drj.advanced) && drj.advanced.length === 0, JSON.stringify(drj.advanced));
  check("送信パラメータ price=2480", drj.willSend?.price === "2480", drj.willSend?.price);

  // 5) update POST（editItem ラウンドトリップ反映）
  const up = await fetch(`${BASE}/api/update/yahoo/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const upj = await up.json();
  check("update POST 200(editItem)", up.status === 200 && upj.ok, `HTTP ${up.status} ${JSON.stringify(upj).slice(0, 160)}`);
  await sleep(2500);

  // 6) getItem 反映確認: 価格2480・headline/caption/display保持
  const got = await getItem(token, cfg.sellerId, NE);
  check("getItem 取得", got.exists, "");
  const after = parseYahooItem(got.raw);
  check("価格2480に反映", after.selling_price === 2480, String(after.selling_price));
  check("見出し保持", after.catch_copy_yahoo === "初期キャッチ", `→ ${after.catch_copy_yahoo}`);
  check("キャプ保持", after.description_pc === "<p>初期キャプ</p>", `→ ${after.description_pc}`);
  check("display=0 非公開維持", /<Display>0<\/Display>/.test(got.raw), "");

  // 7) 後始末
  await sleep(800);
  const del = await deleteItem(token, cfg.sellerId, NE);
  check("deleteItem 後始末", del.ok, del.message);
  await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`);
  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 Yahoo 既存商品編集 E2E 成功（register→fetch→update部分反映）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
