// 一括モール登録 /api/register/bulk/[mall] の実機E2E。
// 安全なテスト商品(楽天: 倉庫・非公開 / Yahoo: display=0)で
// dry-run(既定)→commit→モール側反映確認→上書きガード確認→deleteItem/DB後始末。
// 実行: npx tsx tests/e2e_bulk_register.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem as rGetItem, deleteItem as rDeleteItem } from "../lib/rakuten/item-client.ts";
import { getYahooConfig, getYahooAccessToken } from "../lib/yahoo/auth.ts";
import { getItem as yGetItem, deleteItem as yDeleteItem } from "../lib/yahoo/item-client.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// テスト用: maker=zzz。楽天 manageNumber = zzz-999x（jan末尾4桁）
const MAKER = "zzz";
const RAKUTEN_ATTRS = [
  { item: "メーカー型番", value: "TEST-001", unit: "", requirement: "必須" },
  { item: "タイトル", value: "テスト商品", unit: "", requirement: "必須" },
  { item: "発売元", value: "テストメーカー", unit: "", requirement: "必須" },
];

function productRow(userId, ne, jan, over = {}) {
  return {
    user_id: userId, ne_code: ne, jan_code: jan, maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: `一括登録E2E ${ne}`, display_name: `一括登録E2Eテスト ${ne}`,
    tax_rate: 10, cost_price: 0, selling_price: 1980, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "テスト", description_pc: "<p>説明</p>", description_sp: "<p>SP説明</p>",
    extra: { attributes: RAKUTEN_ATTRS },
    ...over,
  };
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  // JAN は必ず有効なチェックディジットにする（不正JANは楽天が articleNumber を拒否する）
  const NES = ["zzz-9992-1", "zzz-8995-1", "zzz-7998-1", "zzz-6991-1"];
  await admin.from("products").delete().eq("user_id", user.id).in("ne_code", NES);

  // P1/P2: 楽天valid、P3: ジャンル欠落=invalid、P4: Yahoo用（path/カテゴリはトップレベル列）
  const ins = async (row) => (await admin.from("products").insert(row).select("id").single()).data.id;
  const p1 = await ins(productRow(user.id, "zzz-9992-1", "4955028009992"));
  const p2 = await ins(productRow(user.id, "zzz-8995-1", "4955028008995"));
  const p3 = await ins(productRow(user.id, "zzz-7998-1", "4955028007998", { mall_category_id: "" }));
  // image_count:0 = item_image_urls を送らない。実在しない画像を参照すると Yahoo が
  // it-14091 で拒否するため（画像アップロード込みの経路は e2e_register_yahoo.mjs が担当）。
  const p4 = await ins(productRow(user.id, "zzz-6991-1", "4955028006991", {
    yahoo_category_id: "13457", yahoo_path: "テスト", image_count: 0,
  }));
  check("テスト商品4件作成", !!(p1 && p2 && p3 && p4), "");

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const post = async (mall, body) => {
    const res = await fetch(`${BASE}/api/register/bulk/${mall}`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, j: await res.json() };
  };

  // ========== 楽天 ==========
  // 1) dry-run（dryRun 未指定 = 既定が安全側であることも同時に検証）
  {
    const { status, j } = await post("rakuten", { ids: [p1, p2, p3] });
    check("[楽天] dry-run 200 + ok", status === 200 && j.ok, `HTTP ${status}`);
    check("[楽天] dryRun 既定 true", j.dryRun === true, String(j.dryRun));
    check("[楽天] total=3 valid=2 invalid=1", j.total === 3 && j.valid === 2 && j.invalid === 1, JSON.stringify({ t: j.total, v: j.valid, i: j.invalid }));
    const r3 = j.results.find((r) => r.id === p3);
    check("[楽天] P3 は invalid + missing に genreId", r3?.valid === false && (r3?.missing ?? []).some((m) => m.includes("genreId")), JSON.stringify(r3?.missing));
  }

  // 2) commit（valid の2件のみ・安全既定=倉庫非公開）
  {
    const { status, j } = await post("rakuten", { ids: [p1, p2], dryRun: false });
    for (const r of j.results ?? []) if (!r.ok) console.log(`   ↳ 失敗詳細 ${r.ne_code}: ${r.error}`);
    check("[楽天] commit 200 + ok", status === 200 && j.ok, `HTTP ${status}`);
    check("[楽天] succeeded=2 failed=0", j.succeeded === 2 && j.failed === 0, JSON.stringify({ s: j.succeeded, f: j.failed }));
    check("[楽天] 両件 registered + action=create", j.results.every((r) => r.registered === true && r.action === "create"), JSON.stringify(j.results.map((r) => r.action)));
  }

  // 3) モール側反映確認
  await sleep(2000);
  const cred = getRakutenCredentialsFromEnv();
  for (const mn of ["zzz-9992", "zzz-8995"]) {
    const got = await rGetItem(cred, mn);
    check(`[楽天] items.get ${mn} 登録確認`, got.exists, `status=${got.status}`);
  }

  // 4) DB 側の掲載状態更新確認
  {
    const { data } = await admin.from("products").select("extra").eq("id", p1).single();
    check("[楽天] mall_listed.rakuten=true に更新", data?.extra?.mall_listed?.rakuten === true, JSON.stringify(data?.extra?.mall_listed));
  }

  // 5) 上書きガード（overwrite 未指定の再commitはスキップされる）
  {
    const { j } = await post("rakuten", { ids: [p1], dryRun: false });
    const r = j.results[0];
    check("[楽天] 既存あり+overwrite未指定 → skip", r?.action === "skip" && r?.registered !== true && r?.willOverwrite === true, JSON.stringify({ action: r?.action, will: r?.willOverwrite }));
  }

  // ========== Yahoo ==========
  {
    const dr = await post("yahoo", { ids: [p4] });
    check("[Yahoo] dry-run valid", dr.j.ok && dr.j.valid === 1, JSON.stringify(dr.j.results?.[0]?.missing ?? []));
    const co = await post("yahoo", { ids: [p4], dryRun: false });
    const r = co.j.results?.[0];
    if (r && !r.ok) console.log(`   ↳ 失敗詳細 ${r.ne_code}: ${r.error}`);
    check("[Yahoo] commit registered（submitなし・display=0）", co.j.ok && r?.registered === true, "");
    check("[Yahoo] 反映予約は未実施（submitted なし）", co.j.submitted !== true, String(co.j.submitted));
    await sleep(2000);
    const cfg = getYahooConfig();
    const token = await getYahooAccessToken(cfg);
    const got = await yGetItem(token, cfg.sellerId, "zzz-6991-1");
    check("[Yahoo] getItem 登録確認", got.exists, got.exists ? "存在" : "未検出");
    const del = await yDeleteItem(token, cfg.sellerId, "zzz-6991-1");
    check("[Yahoo] deleteItem 後始末", del.ok, del.message);
  }

  // ========== 後始末（楽天） ==========
  await sleep(1000);
  for (const mn of ["zzz-9992", "zzz-8995"]) {
    const del = await rDeleteItem(cred, mn);
    check(`[楽天] items.delete ${mn} 後始末`, del.ok, `status=${del.status} ${del.message ?? ""}`);
  }
  await admin.from("products").delete().eq("user_id", user.id).in("ne_code", NES);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 一括登録 実機E2E 成功（dry-run→commit→確認→上書きガード→削除）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
