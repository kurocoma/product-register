// 楽天 items.upsert 商品登録のE2E。安全なテスト商品(hideItem=倉庫=非公開)で
// dry-run(GET)→commit(POST upsert)→items.get反映確認→items.delete後始末。
// 実行: npx tsx tests/e2e_register_rakuten.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { buildRakutenManageNumber, buildRakutenUpsertBody, validateUpsertBody } from "../lib/converters/rakuten-api.ts";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, deleteItem } from "../lib/rakuten/item-client.ts";
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

// テスト用: maker=zzz, jan末尾4桁=9996 → manageNumber=zzz-9996
const MAKER = "zzz", JAN = "4955028009996"; // 末尾4桁9996。チェックディジット不問(exemptionReasonになる)
const NE = "zzz-9996-1";

// --- 0) マッパー ユニット検証 ---
{
  const p = makeProduct({ ne_code: NE, maker_code: MAKER, jan_code: "4955028002542", display_name: "楽天登録テスト", mall_category_id: "553575", selling_price: 1980 });
  const mn = buildRakutenManageNumber(p);
  const body = buildRakutenUpsertBody(p);
  check("manageNumber = base_code", mn === "zzz-2542", mn);
  check("itemType NORMAL", body.itemType === "NORMAL");
  check("genreId", body.genreId === "553575", String(body.genreId));
  check("variants[ne_code].standardPrice", body.variants?.[NE]?.standardPrice === "1980", JSON.stringify(body.variants?.[NE]?.standardPrice));
  check("articleNumber value(13桁JAN)", body.variants?.[NE]?.articleNumber?.value === "4955028002542", JSON.stringify(body.variants?.[NE]?.articleNumber));
  check("validate ok", validateUpsertBody(mn, body).ok, JSON.stringify(validateUpsertBody(mn, body)));
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: "4955028002542", maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: "楽天登録E2E", display_name: "楽天登録E2Eテスト商品",
    tax_rate: 10, cost_price: 0, selling_price: 1980, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "テストキャッチ", description_pc: "<p>説明</p>", description_sp: "<p>SP説明</p>",
    extra: {
      attributes: [
        { item: "メーカー型番", value: "TEST-001", unit: "", requirement: "必須" },
        { item: "タイトル", value: "テスト商品", unit: "", requirement: "必須" },
        { item: "発売元", value: "テストメーカー", unit: "", requirement: "必須" },
      ],
    },
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  const manageNumber = "zzz-2542"; // baseCodeOf(maker=zzz, jan末尾2542)

  // 1) dry-run (GET)
  const dr = await fetch(`${BASE}/api/register/rakuten/${prod.id}?dryRun=1`, { headers: { Cookie: cookie } });
  const drj = await dr.json();
  check("dry-run GET 200", dr.status === 200 && drj.ok, `HTTP ${dr.status}`);
  check("dry-run valid", drj.valid === true, JSON.stringify(drj.missing || []));
  check("dry-run manageNumber", drj.manageNumber === manageNumber, drj.manageNumber);

  // 2) commit (POST) hideItem=true(倉庫=非公開)
  const co = await fetch(`${BASE}/api/register/rakuten/${prod.id}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hideItem: true }),
  });
  const coj = await co.json();
  check("commit POST 200 (upsert)", co.status === 200 && coj.ok, `HTTP ${co.status} ${JSON.stringify(coj).slice(0, 200)}`);

  // 3) items.get 反映確認
  await sleep(2000);
  const cred = getRakutenCredentialsFromEnv();
  const got = await getItem(cred, manageNumber);
  check("items.get で登録確認", got.exists, `status=${got.status}`);

  // 4) 後始末: items.delete
  await sleep(1000);
  const del = await deleteItem(cred, manageNumber);
  check("items.delete 後始末", del.ok, `status=${del.status} ${del.message}`);

  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 楽天商品登録 E2E 成功（dry-run→upsert→確認→削除）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
