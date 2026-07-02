// Yahoo 商品登録(editItem のみ・submitなし)のE2E。e2e_register_yahoo.mjs の安全変種。
// 本家は commit で submit:true（reservePublish=ストア全体の反映予約）まで行うが、
// 反復実行タスクでは「publish/submit/公開反映を一切行わない」制約があるため、
// editItem(display=0)→getItem確認→deleteItem後始末 のみを行い、反映予約は呼ばない。
// （editItem は編集領域への書き込みで、reservePublish しない限り公開ストアには反映されない。
//   getItem は編集領域を読むため、submit なしでも登録確認できる＝e2e_bulk_register と同じ性質）
// 実行: npx tsx tests/e2e_register_yahoo_nosubmit.mjs
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

const NE = "zzz-y-nosub-9998"; // テスト用item_code（本家 zzz-y-reg-9997 と衝突しない）

// --- 0) マッパー ユニット検証（オフライン） ---
{
  const p = makeProduct({ ne_code: "t002-2542-1", display_name: "テスト商品", yahoo_path: "テスト", yahoo_category_id: "13457", selling_price: 1000 });
  const params = buildYahooEditItemParams(p, { sellerId: "okimarumarket" });
  check("マッパー: item_code 改名", params.item_code === "t002-2542-1", params.item_code);
  check("マッパー: 必須充足", validateEditItemParams(params).ok, JSON.stringify(validateEditItemParams(params)));
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  // テスト商品（Yahooカテゴリ実在ID 13457=その他 を使用、価格1000）
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028002542", maker_code: "zzz",
    product_type: "単品", quantity: 1, product_name: "Yahoo登録E2E(nosubmit)", display_name: "Yahoo登録E2Eテスト商品(反映予約なし)",
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

  // 2) commit (POST) — display=0(非公開)で editItem のみ。submit(反映予約)は一切行わない
  const co = await fetch(`${BASE}/api/register/yahoo/${prod.id}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ forceDisplay: "0" }),
  });
  const coj = await co.json();
  check("commit POST 200 (editItem)", co.status === 200 && coj.ok, `HTTP ${co.status} ${JSON.stringify(coj).slice(0, 160)}`);
  check("反映予約は未実施（submitted=false）", coj.submitted !== true, String(coj.submitted));
  if (coj.warnings?.length) console.log("   warnings:", coj.warnings.join(" | "));

  // 3) getItem 反映確認（編集領域を読むため submit なしでも確認できる）
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

  console.log(fail === 0 ? "\n🎉 Yahoo商品登録 E2E 成功（dry-run→editItem(display=0)→確認→削除・反映予約なし）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
