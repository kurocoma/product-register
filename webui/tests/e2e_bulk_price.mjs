// 一括価格編集 API のE2E。単品+多SKU商品を作り、％/円/固定額の各モードで
// selling_price と variants[].selling_price が一括変更されることを検証→後始末。
// 実行: npx tsx tests/e2e_bulk_price.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const ck = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };
const NE1 = "zzbp-1", NE2 = "zzbp-2";

async function priceOf(id) {
  const { data } = await admin.from("products").select("selling_price, extra").eq("id", id).single();
  return { flat: data.selling_price, variants: (data.extra?.variants || []).map((v) => v.selling_price) };
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const u = list.users.find((x) => x.email === "kmzt.i-0001@kurocommerce.com");
  await admin.from("products").delete().eq("user_id", u.id).in("ne_code", [NE1, NE2]);
  const base = { user_id: u.id, maker_code: "zzbp", product_type: "単品", quantity: 1, tax_rate: 10, cost_price: 0, shipping_type: "送料別", image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "" };
  const single = (await admin.from("products").insert({ ...base, ne_code: NE1, jan_code: "4955028002542", product_name: "単品", display_name: "単品", selling_price: 1000 }).select("id").single()).data;
  const multi = (await admin.from("products").insert({ ...base, ne_code: NE2, jan_code: "4955028002559", product_name: "多SKU", display_name: "多SKU", selling_price: 500,
    extra: { variants: [
      { sku_manage_number: "s-a", ne_code: "s-a", jan_code: "4955028002542", selling_price: 500, tax_rate: 10, quantity: 1, variation_value: "A", shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "", shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: [] },
      { sku_manage_number: "s-b", ne_code: "s-b", jan_code: "4955028002559", selling_price: 2000, tax_rate: 10, quantity: 1, variation_value: "B", shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "", shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: [] },
    ] } }).select("id").single()).data;

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([n, v]) => ({ name: n, value: v })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };
  const apply = async (mode, value) => (await (await fetch(`${BASE}/api/products/bulk-price`, { method: "POST", headers: H, body: JSON.stringify({ ids: [single.id, multi.id], mode, value }) })).json());

  // ％ +10
  const r1 = await apply("pct", 10);
  ck("％ updated=2", r1.ok && r1.updated === 2, JSON.stringify(r1).slice(0, 80));
  ck("単品 1000→1100", (await priceOf(single.id)).flat === 1100);
  const m1 = await priceOf(multi.id);
  ck("多SKU flat 500→550・variants 500/2000→550/2200", m1.flat === 550 && JSON.stringify(m1.variants) === "[550,2200]", JSON.stringify(m1));

  // 円 +50
  await apply("yen", 50);
  ck("単品 1100→1150(+50円)", (await priceOf(single.id)).flat === 1150);
  const m2 = await priceOf(multi.id);
  ck("多SKU variants 550/2200→600/2250(+50円)", JSON.stringify(m2.variants) === "[600,2250]", JSON.stringify(m2.variants));

  // 固定額 999
  await apply("set", 999);
  ck("単品 固定額999", (await priceOf(single.id)).flat === 999);
  const m3 = await priceOf(multi.id);
  ck("多SKU 固定額: flat/variants 全て999", m3.flat === 999 && JSON.stringify(m3.variants) === "[999,999]", JSON.stringify(m3));

  await admin.from("products").delete().eq("user_id", u.id).in("ne_code", [NE1, NE2]);
  ck("後始末", true, "");
  console.log(fail === 0 ? "\n🎉 一括価格編集 E2E 成功（％/円/固定額・単品+多SKU variants連動）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
