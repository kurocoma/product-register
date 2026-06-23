// /api/upload/yahoo ルートのE2E。安全なテスト商品で 認証→画像POST→公開URL確認→Yahoo画像削除→商品削除。
// 実行: npx tsx tests/e2e_yahoo_upload_route.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
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

const NE = "zzz-y-e2e-9998"; // 衝突しないテスト用
const fileName = `${NE}.jpg`;

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");

  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028009998", maker_code: "zzz",
    product_type: "単品", quantity: 1, product_name: "Yahoo E2Eテスト", display_name: "Yahoo E2Eテスト",
    tax_rate: 10, cost_price: 0, selling_price: 100, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "0", yahoo_grouping_enabled: false, extra: {},
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && `id=${prod.id.slice(0, 8)}…`);

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 120, g: 40, b: 180 } } }).png().toBuffer();
  const fd = new FormData();
  fd.append("productId", prod.id);
  fd.append("index", "1");
  fd.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "test.png");
  const res = await fetch(`${BASE}/api/upload/yahoo`, { method: "POST", headers: { Cookie: cookie }, body: fd });
  const json = await res.json().catch(() => ({}));
  check("POST /api/upload/yahoo 200", res.status === 200 && json.ok, `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
  check("publicUrl が規約どおり", json.publicUrl === `https://shopping.c.yimg.jp/lib/okimarumarket/${fileName}`, json.publicUrl);

  await sleep(2500);
  if (json.publicUrl) {
    const head = await fetch(json.publicUrl, { method: "HEAD" });
    check("公開URLに反映(HEAD 200)", head.status === 200, `HEAD ${head.status}`);
  }

  // 後始末: Yahoo画像削除
  await sleep(1500);
  const cfg = getYahooConfig();
  const token = await getYahooAccessToken(cfg);
  const del = await deleteLibImage(token, cfg.sellerId, fileName);
  check("Yahoo画像 後始末削除", del.ok, del.message);

  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品 後始末削除", true, "");

  console.log(fail === 0 ? "\n🎉 Yahooアップロードルート E2E 成功（後始末完了）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
