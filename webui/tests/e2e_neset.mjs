// ne_set が 0byte だったのは「単品商品だから」という仕様の検証。
// セット商品を登録して ne_set CSV に中身が出ること、単品なら ne_single に出ることを確認する。
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";
const env = readFileSync(".env.local", "utf8");
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const URL_ = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const jar = new Map();
const ssr = () => createServerClient(URL_, ANON, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
});
const cookieHeader = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
const get = (p) => fetch(BASE + p, { redirect: "manual", headers: { Cookie: cookieHeader() } });

const admin = createClient(URL_, SVC, { auth: { autoRefreshToken: false, persistSession: false } });

function baseRow(user_id, overrides) {
  return {
    user_id, jan_code: "4955028002542", maker_code: "e2e",
    quantity: 1, product_name: "E2E商品", display_name: "E2E 表示名",
    tax_rate: 10, cost_price: 0, selling_price: 10000,
    shipping_type: "送料無料", image_count: 1, delivery_method: 4, lead_time: 1,
    mall_category_id: "402930", store_category: "沖縄のお酒",
    yahoo_grouping_enabled: false, extra: {}, ...overrides,
  };
}

async function csvBytes(mall, id) {
  const res = await get(`/api/csv/${mall}/${id}`);
  if (res.status !== 200) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, bytes: buf.length };
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kurocommerce@gmail.com");
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr().auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });

  let pass = true;

  // (A) 単品商品: ne_single に中身 / ne_set は空（仕様）
  const single = (await admin.from("products").insert(baseRow(user.id, {
    ne_code: "e2e-single-2542-1", product_type: "単品",
  })).select().single()).data;
  const sSingle = await csvBytes("ne_single", single.id);
  const sSet = await csvBytes("ne_set", single.id);
  const aOk = sSingle.bytes > 0 && sSet.bytes === 0;
  console.log(`${aOk ? "✅" : "❌"} 単品商品: ne_single=${sSingle.bytes}B (中身あり期待) / ne_set=${sSet.bytes}B (0期待=仕様)`);
  pass = pass && aOk;

  // (B) セット商品: ne_set に中身が出る
  const set = (await admin.from("products").insert(baseRow(user.id, {
    ne_code: "e2e-set-2542-3", product_type: "セット商品", quantity: 3,
  })).select().single()).data;
  const setSet = await csvBytes("ne_set", set.id);
  const bOk = setSet.bytes > 0;
  console.log(`${bOk ? "✅" : "❌"} セット商品: ne_set=${setSet.bytes}B (中身あり期待)`);
  pass = pass && bOk;

  // 後始末
  await admin.from("products").delete().in("id", [single.id, set.id]);
  console.log("\n" + (pass
    ? "🎉 結論: ne_set 0byte は『単品だから』で正常。セット商品なら ne_set に中身が出る。バグではない。"
    : "⚠ 想定外: さらに調査が必要"));
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(3); });
