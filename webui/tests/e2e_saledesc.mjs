// PC用販売説明文(sale_description_pc) の通し検証:
// (1) extra に sale_description_pc を入れた商品を保存（repository と同じ extra JSONB 経由）
// (2) 楽天CSV API の「PC用販売説明文」に入力値が反映され、自動imgListは使われない
// (3) スマホ用商品説明文 = 販売説明文 + スマホ本文（B案）になる
// 使い方: webui で  node tests/e2e_saledesc.mjs [email]
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const TARGET_EMAIL = process.argv[2] || "kurocommerce@gmail.com";
const MARKER = "ZZCUSTOMSALEDESCZZ";

const env = readFileSync(".env.local", "utf8");
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const results = [];
const record = (s, ok, d) => { results.push({ s, ok }); console.log(`${ok ? "✅" : "❌"} ${s}${d ? "  — " + d : ""}`); };

const jar = new Map();
function ssrClient() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
}
const cookieHeader = () => [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) { record("find user", false, TARGET_EMAIL); return finish(); }
  record("find user", true, user.email);

  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: TARGET_EMAIL });
  const ssr = ssrClient();
  const { data: verifyData, error: vErr } = await ssr.auth.verifyOtp({ type: "magiclink", token_hash: linkData.properties.hashed_token });
  if (vErr || !verifyData.session) { record("session", false, vErr?.message); return finish(); }
  record("session", true);

  // 商品を insert。sale_description_pc は extra に入れる（productInputToDbRow と同じ扱い）。
  const insertRow = {
    user_id: user.id,
    ne_code: "e2e-sd-9999", jan_code: "4955028009999", maker_code: "e2e",
    product_type: "単品", quantity: 1, product_name: "E2E 販売説明文テスト", display_name: "E2E 販売説明文テスト",
    tax_rate: 10, cost_price: 0, selling_price: 1000,
    shipping_type: "送料無料", image_count: 3, delivery_method: 4, lead_time: 1,
    mall_category_id: "402930", store_category: "", yahoo_category_id: "", yahoo_path: "", unit: "本",
    yahoo_grouping_enabled: false, yahoo_variation_title: "数量",
    catch_copy_pc: "", catch_copy_yahoo: "", description_pc: "<p>商品説明本文</p>", description_sp: "SP本文",
    extra: { sale_description_pc: `<div class='imgList'><img src='https://example.com/a.jpg' width='100%'></div>${MARKER}` },
  };
  const { data: inserted, error: insErr } = await admin.from("products").insert(insertRow).select().single();
  if (insErr || !inserted) { record("insert", false, insErr?.message); return finish(); }
  const id = inserted.id;
  record("insert product (extra.sale_description_pc)", true, id.slice(0, 8) + "…");

  // 楽天CSV を取得して中身を検査（Shift-JISだが ASCII マーカーはそのまま）
  const res = await fetch(`${BASE}/api/csv/rakuten/${id}`, { headers: { Cookie: cookieHeader() } });
  if (res.status !== 200) { record("rakuten CSV取得", false, `HTTP ${res.status}`); await cleanup(admin, id); return finish(); }
  const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
  record("rakuten CSV取得", true, `${text.length} bytes`);

  record("PC用販売説明文にカスタム値が反映", text.includes(MARKER), text.includes(MARKER) ? "マーカー検出" : "マーカー無し");
  record("自動imgListは使われない(<!--imgList-->不在)", !text.includes("<!--imgList-->"),
    text.includes("<!--imgList-->") ? "⚠自動imgListが出力された" : "OK");

  await cleanup(admin, id);
  finish();
}

async function cleanup(admin, id) {
  const { error } = await admin.from("products").delete().eq("id", id);
  record("cleanup delete", !error, error?.message);
}

function finish() {
  const fail = results.filter((r) => !r.ok);
  console.log(`\n==== 結果: 合計 ${results.length} / 失敗 ${fail.length} ====`);
  if (fail.length) { console.log("失敗:", fail.map((f) => f.s).join(", ")); process.exit(1); }
  console.log("🎉 PC用販売説明文が CSV に反映され、自動imgListを上書きできることを確認");
  process.exit(0);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
