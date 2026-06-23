// 楽天 外部作成商品(variantキー≠NEコード≠管理番号)の編集E2E。
// IE0269/IE0229/IE0418 回帰防止: patch は ne_code でなく実 variant キー(rakuten_variant_id)を使うこと。
//   DB商品(rakuten_variant_id=VK / ne_code=NE / rakuten_manage_number=MN を全部別値)を作成
//   → register(VKで作成,merchantDefinedSkuId=NE) → fetch → 価格変更 → update GET(willSendがVK配下)
//   → update POST(patch) → getItem価格反映 → items.delete + DB削除。
// 前提: dev server が http://localhost:3000。実行: npx tsx tests/e2e_update_rakuten_extkey.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, deleteItem } from "../lib/rakuten/item-client.ts";
import { parseRakutenItem } from "../lib/converters/rakuten-item-parser.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-extne-1";   // ne_code = システム連携用SKU番号(merchantDefinedSkuId)
const VK = "zzz-extvk-1";   // variant キー(SKU管理番号) — NEと別物
const MN = "zzz-extmn";     // 商品管理番号 — さらに別物
const JAN = "4955028002542";

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cred = getRakutenCredentialsFromEnv();
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  try { await deleteItem(cred, MN); } catch { /* noop */ }

  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: JAN, maker_code: "zzu",
    product_type: "単品", quantity: 1, product_name: "外部キーE2E", display_name: "外部キーE2E商品",
    tax_rate: 10, cost_price: 0, selling_price: 1980, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    description_pc: "<p>初期PC</p>", description_sp: "<p>初期SP</p>",
    extra: {
      rakuten_variant_id: VK, rakuten_manage_number: MN,
      attributes: [
        { item: "メーカー型番", value: "EXT-001", unit: "", requirement: "必須" },
        { item: "タイトル", value: "外部キー", unit: "", requirement: "必須" },
        { item: "発売元", value: "テスト", unit: "", requirement: "必須" },
      ],
    },
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) register（VKで作成、管理番号=MN、merchantDefinedSkuId=NE）
  const reg = await fetch(`${BASE}/api/register/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const regj = await reg.json();
  check("register POST 200(管理番号=MN)", reg.status === 200 && regj.ok && regj.manageNumber === MN, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 160)}`);
  await sleep(2000);

  // 登録直後の構造確認: variantキー=VK, merchantDefinedSkuId=NE
  const got0 = await getItem(cred, MN);
  const key0 = Object.keys(got0.json?.variants || {})[0];
  check("variantキー=VK", key0 === VK, key0);
  check("merchantDefinedSkuId=NE", got0.json?.variants?.[VK]?.merchantDefinedSkuId === NE, got0.json?.variants?.[VK]?.merchantDefinedSkuId);

  // 2) fetch（取込）
  const fe = await fetch(`${BASE}/api/fetch/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  check("fetch POST 200", fe.status === 200, `HTTP ${fe.status}`);

  // 3) 価格 1980→3980
  await admin.from("products").update({ selling_price: 3980 }).eq("id", prod.id);

  // 4) update GET（willSend が VK 配下であること＝ne_codeでないこと）
  const dr = await fetch(`${BASE}/api/update/rakuten/${prod.id}`, { headers: { Cookie: cookie } });
  const drj = await dr.json();
  check("update GET 200", dr.status === 200 && drj.ok, `HTTP ${dr.status}`);
  check("★patch対象キー=VK(ne_codeでない)", drj.willSend?.variants?.[VK]?.standardPrice === "3980", JSON.stringify(drj.willSend?.variants));
  check("★ne_codeキーでは送らない", !drj.willSend?.variants?.[NE], JSON.stringify(Object.keys(drj.willSend?.variants || {})));

  // 5) update POST（patch 実行）→ 成功するはず（誤キーなら IE0269/IE0229/IE0418）
  const up = await fetch(`${BASE}/api/update/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const upj = await up.json();
  check("★update POST 200(patch成功=回帰解消)", up.status === 200 && upj.ok, `HTTP ${up.status} ${JSON.stringify(upj).slice(0, 200)}`);
  await sleep(2000);

  // 6) 反映確認
  const got = await getItem(cred, MN);
  const after = parseRakutenItem(got.json);
  check("価格3980に反映", after.selling_price === 3980, String(after.selling_price));
  check("title不変", after.display_name === "外部キーE2E商品", after.display_name);

  // 7) 後始末
  await sleep(800);
  const del = await deleteItem(cred, MN);
  check("items.delete 後始末", del.ok, `status=${del.status}`);
  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 楽天 外部キー編集 E2E 成功（patchは実variantキーを使う）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
