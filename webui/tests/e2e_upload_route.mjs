// /api/upload/rcabinet ルートのE2E。安全なテスト商品(ne_code衝突なし)で
// 認証→画像POST→公開URL確認→R-Cabinet画像削除→テスト商品削除 まで後始末する。
// 実行: npx tsx tests/e2e_upload_route.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { deleteCabinetFile, searchFile } from "../lib/rakuten/cabinet-client.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const cred = { serviceSecret: get("RAKUTEN_SERVICE_SECRET"), licenseKey: get("RAKUTEN_LICENSE_KEY") };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// 衝突しないテスト用 ne_code（既存商品画像を上書きしない）
const NE = "zzz-e2e-9999";
const filePath = `${NE}.jpg`;

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");

  // テスト商品を作成
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028009999", maker_code: "zzz",
    product_type: "単品", quantity: 1, product_name: "E2Eアップロードテスト", display_name: "E2Eアップロードテスト",
    tax_rate: 10, cost_price: 0, selling_price: 100, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "0", yahoo_grouping_enabled: false, extra: {},
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && `id=${prod.id.slice(0, 8)}…`);

  // ユーザーセッション cookie
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  // テスト画像（緑200x200 PNG）
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 40, g: 180, b: 60 } } }).png().toBuffer();

  // ルートへ POST
  const fd = new FormData();
  fd.append("productId", prod.id);
  fd.append("kind", "main");
  fd.append("index", "1");
  fd.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "test.png");
  const res = await fetch(`${BASE}/api/upload/rcabinet`, { method: "POST", headers: { Cookie: cookie }, body: fd });
  const json = await res.json().catch(() => ({}));
  check("POST /api/upload/rcabinet 200", res.status === 200 && json.ok, `HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
  check("publicUrl が規約どおり", json.publicUrl === `https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/${filePath}`, json.publicUrl);

  // 公開URLで反映確認
  await sleep(1500);
  if (json.publicUrl) {
    const head = await fetch(json.publicUrl, { method: "HEAD" });
    check("公開URLに反映(HEAD 200)", head.status === 200, `HEAD ${head.status}`);
  }

  // 後始末: R-Cabinet 画像削除
  await sleep(1500);
  let fileId = json.fileId;
  if (!fileId) { const hits = await searchFile(cred, NE); fileId = hits.find((h) => h.filePath === filePath)?.fileId; }
  if (fileId) { const del = await deleteCabinetFile(cred, String(fileId)); check("R-Cabinet画像 後始末削除", del.ok, del.message); }
  else check("R-Cabinet画像 後始末削除", false, "⚠ fileId取得不可。手動でthum02/" + filePath + "を削除");

  // 後始末: テスト商品削除
  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品 後始末削除", true, "");

  console.log(fail === 0 ? "\n🎉 アップロードルート E2E 成功（後始末完了）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
