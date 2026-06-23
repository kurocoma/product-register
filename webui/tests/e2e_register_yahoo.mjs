// Yahoo 商品登録(editItem→submitItem)のE2E。安全なテスト商品(display=0=非公開)で
// dry-run(GET)→commit(POST editItem)→getItem反映確認→submitItem→deleteItem後始末。
// 実行: npx tsx tests/e2e_register_yahoo.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { buildYahooEditItemParams, validateEditItemParams } from "../lib/yahoo/item-mapper.ts";
import sharp from "sharp";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { getItem, deleteItem } from "../lib/yahoo/item-client.ts";
import { uploadLibImage, deleteLibImage } from "../lib/yahoo/lib-image-client.ts";
import { makeProduct } from "../lib/product/schema.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-y-reg-9997"; // テスト用item_code（本番衝突なし）

// --- 0) マッパー ユニット検証（オフライン） ---
{
  const p = makeProduct({ ne_code: "t002-2542-1", display_name: "テスト商品", yahoo_path: "テスト", yahoo_category_id: "13457", selling_price: 1000 });
  const params = buildYahooEditItemParams(p, { sellerId: "okimarumarket" });
  check("マッパー: item_code 改名", params.item_code === "t002-2542-1", params.item_code);
  check("マッパー: 必須充足", validateEditItemParams(params).ok, JSON.stringify(validateEditItemParams(params)));
  check("マッパー: ハイフン→_(item_image_urls)", "item_image_urls" in params, Object.keys(params).filter(k => k.includes("image")).join(","));
  check("マッパー: CSV専用pr_rate除外", !("pr_rate" in params) && !("pr-rate" in params), "");
  const upd = buildYahooEditItemParams(p, { sellerId: "okimarumarket", forUpdate: true });
  check("マッパー: 更新時 display 不送信", !("display" in upd), "display=" + upd.display);
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  // テスト商品（Yahooカテゴリ実在ID 13457=その他 を使用、価格1000）
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028002542", maker_code: "zzz",
    product_type: "単品", quantity: 1, product_name: "Yahoo登録E2E", display_name: "Yahoo登録E2Eテスト商品",
    tax_rate: 10, cost_price: 0, selling_price: 1000, shipping_type: "送料別",
    image_count: 1, delivery_method: 1, lead_time: 1, mall_category_id: "0",
    yahoo_category_id: "13457", yahoo_path: "テスト", yahoo_grouping_enabled: false,
    catch_copy_yahoo: "テストキャッチ", description_pc: "<p>説明</p>", extra: {},
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  // 0.5) editItem の item_image_urls が参照する lib画像を先にアップロード（実フロー: 画像→登録）
  const cfg0 = getYahooConfig();
  const token0 = await getYahooAccessToken(cfg0);
  const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 60, g: 140, b: 200 } } }).jpeg().toBuffer();
  const upImg = await uploadLibImage(token0, cfg0.sellerId, { fileName: `${NE}.jpg`, jpeg });
  check("テスト用lib画像アップロード", upImg.ok, upImg.ok ? "" : upImg.message);
  await sleep(1500);

  // セッション
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  // 1) dry-run (GET) — 書き込みなし
  const dr = await fetch(`${BASE}/api/register/yahoo/${prod.id}?dryRun=1`, { headers: { Cookie: cookie } });
  const drj = await dr.json();
  check("dry-run GET 200", dr.status === 200 && drj.ok, `HTTP ${dr.status}`);
  check("dry-run: 必須valid", drj.valid === true, JSON.stringify(drj.missing || []));
  check("dry-run: item_code 一致", drj.itemCode === NE, drj.itemCode);

  // 2) commit (POST) — display=0(非公開)で editItem + submit
  const co = await fetch(`${BASE}/api/register/yahoo/${prod.id}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ submit: true, forceDisplay: "0" }),
  });
  const coj = await co.json();
  check("commit POST 200 (editItem)", co.status === 200 && coj.ok, `HTTP ${co.status} ${JSON.stringify(coj).slice(0, 160)}`);
  if (coj.warnings?.length) console.log("   warnings:", coj.warnings.join(" | "));

  // 3) getItem 反映確認
  await sleep(2000);
  const cfg = getYahooConfig();
  const token = await getYahooAccessToken(cfg);
  const got = await getItem(token, cfg.sellerId, NE);
  check("getItem で登録確認", got.exists, got.exists ? "存在" : "未検出(反映待ちの可能性)");

  // 4) 後始末: deleteItem
  await sleep(1000);
  const del = await deleteItem(token, cfg.sellerId, NE);
  check("deleteItem 後始末", del.ok, del.message);

  const delImg = await deleteLibImage(token, cfg.sellerId, `${NE}.jpg`);
  check("lib画像 後始末削除", delImg.ok, delImg.message);

  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 Yahoo商品登録 E2E 成功（dry-run→editItem→submit→確認→削除）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
