// 新機能の通し検証:
// (1) カテゴリID 402930 で属性マスタを引く（fetchGenreAttributes 相当）
// (2) 一部に値を入れた attributes を持つ商品を保存
// (3) 楽天CSV API が「値ありの属性だけ」を正しく出力する
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const env = readFileSync(".env.local", "utf8");
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const URL_ = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const TARGET = "kmzt.i-0001@kurocommerce.com";
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

let pass = true;
const check = (label, cond, detail) => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  — " + detail : ""}`);
  pass = pass && cond;
};

async function main() {
  // セッション確立
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === TARGET);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: TARGET });
  const jar = new Map();
  const userClient = createClient(URL_, ANON, {
    auth: { persistSession: false },
    cookies: undefined,
  });
  const { data: v } = await userClient.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  // cookie はSSR用ではなくここではAPI用にアクセストークンをcookie化
  const { createServerClient } = await import("@supabase/ssr");
  const ssr = createServerClient(URL_, ANON, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
  });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: (await admin.auth.admin.generateLink({ type: "magiclink", email: TARGET })).data.properties.hashed_token });
  const cookie = [...jar].map(([n, val]) => `${n}=${val}`).join("; ");

  // (1) 属性マスタを引く
  const { data: attrs, error: aErr } = await userClient
    .from("rakuten_genre_attributes").select("item_name,recommended_unit,sort_order")
    .eq("genre_id", "402930").order("sort_order");
  check("(1) カテゴリ402930の属性取得", !aErr && attrs.length > 0, `${attrs?.length}件`);
  const itemNames = attrs.map((a) => a.item_name);
  check("  期待項目を含む", itemNames.includes("単品容量") && itemNames.includes("アルコール度数"), itemNames.slice(0, 3).join(", ") + "...");

  // (2) attributesに一部だけ値を入れて商品保存（単品容量=720ml に値、他は空）
  const attributes = attrs.map((a) => ({
    item: a.item_name,
    value: a.item_name === "単品容量" ? "720" : a.item_name === "アルコール度数" ? "25" : "",
    unit: a.recommended_unit || "",
  }));
  const ne = "e2e-attr-" + user.id.slice(0, 4);
  await admin.from("products").delete().eq("user_id", user.id).like("ne_code", "e2e-attr-%");
  const { data: prod, error: pErr } = await admin.from("products").insert({
    user_id: user.id, ne_code: ne, jan_code: "4955028002542", maker_code: "e2e",
    product_type: "単品", quantity: 1, product_name: "属性E2E", display_name: "属性E2E",
    tax_rate: 10, cost_price: 0, selling_price: 1000, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "402930",
    yahoo_grouping_enabled: false, extra: { attributes },
  }).select("id").single();
  check("(2) attributes付き商品を保存", !pErr && prod?.id, pErr?.message || `id=${prod?.id.slice(0, 8)}…`);

  // (3) 楽天CSVを取得し、値ありの属性だけ出ることを確認
  const res = await fetch(`${BASE}/api/csv/rakuten/${prod.id}`, { headers: { Cookie: cookie } });
  const csvBuf = Buffer.from(await res.arrayBuffer());
  // cp932 を decode
  const iconv = (await import("iconv-lite")).default;
  const csv = iconv.decode(csvBuf, "cp932");
  check("(3) 楽天CSV取得", res.status === 200 && csvBuf.length > 0, `HTTP ${res.status} ${csvBuf.length}B`);
  // 「単品容量」「アルコール度数」が出て、値が空の「シリーズ名」等は属性として出ない
  const hasValued = csv.includes("単品容量") && csv.includes("アルコール度数");
  // 値が空の項目（総本数等）が商品属性（項目）として出ていないこと: 値ありは2件なので項目3以降は空
  check("  値ありの属性(単品容量/アルコール度数)がCSVに出る", hasValued, "");
  // ヘッダー行で商品属性（項目）の数を数える（値ありのみ=最大2項目に絞られる想定）
  const header = csv.split(/\r?\n/)[0];
  const attrItemCols = (header.match(/商品属性（項目）/g) || []).length;
  check("  商品属性（項目）列が値あり分(2)に絞られる", attrItemCols === 2, `項目列数=${attrItemCols}`);

  await admin.from("products").delete().eq("user_id", user.id).like("ne_code", "e2e-attr-%");
  console.log("\n" + (pass ? "🎉 属性補完→保存→値ありのみCSV出力 が一気通貫で動作" : "⚠ 検証失敗あり"));
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
