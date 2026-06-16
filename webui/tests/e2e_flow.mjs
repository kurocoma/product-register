// E2E: Service Role でユーザーのセッションを発行 → @supabase/ssr に cookie を書かせる
// → その cookie で 全ページSSR / 商品insert / 全モールCSV を実HTTPで叩き、
// Turbopack worker クラッシュ(Jest worker error)が再発しないこと・各機能が動くことを検証する。
// 使い方: webui ディレクトリで  node tests/e2e_flow.mjs [対象ユーザーのemail]
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const TARGET_EMAIL = process.argv[2] || "kurocommerce@gmail.com";

const env = readFileSync(".env.local", "utf8");
const getEnv = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim() : null;
};
const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? "  — " + detail : ""}`);
}

// --- cookie jar（@supabase/ssr に正しい形式で書かせ、ここに溜める） ---
const jar = new Map();
function ssrClient() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(list) {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  });
}
function cookieHeader() {
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}
async function httpGet(path) {
  return fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookieHeader() } });
}

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 0) 対象ユーザーを特定
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (listErr) { record("admin listUsers", false, listErr.message); return finish(); }
  const user = list.users.find((u) => u.email === TARGET_EMAIL);
  if (!user) { record("find user", false, `${TARGET_EMAIL} not found`); return finish(); }
  record("find user", true, `${user.email} id=${user.id.slice(0, 8)}…`);

  // 1) admin でこのユーザーの magic link を生成 → token から本物のセッションを得る
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TARGET_EMAIL,
  });
  if (linkErr) { record("generateLink", false, linkErr.message); return finish(); }
  const otp = linkData.properties?.hashed_token;
  if (!otp) { record("generateLink", false, "no hashed_token"); return finish(); }
  record("generateLink", true, "hashed_token 取得");

  // 2) ssr クライアントで verifyOtp → ライブラリが cookie(jar) にセッションを書く
  const ssr = ssrClient();
  const { data: verifyData, error: verifyErr } = await ssr.auth.verifyOtp({
    type: "magiclink",
    token_hash: otp,
  });
  if (verifyErr || !verifyData.session) {
    record("verifyOtp(セッション確立)", false, verifyErr ? verifyErr.message : "no session");
    return finish();
  }
  record("verifyOtp(セッション確立)", true, `cookies=${jar.size}`);

  // 3) cookie が本当に効くか: middleware を通る保護ページ / が 200 で返るか
  {
    const res = await httpGet("/");
    record("認証cookie検証 (GET /)", res.status === 200, `HTTP ${res.status}${res.status === 307 ? " (→loginリダイレクト=認証失敗)" : ""}`);
    if (res.status !== 200) return finish();
  }

  // 4) 全ページ SSR（worker クラッシュの直接の再現テスト）
  const pages = ["/products", "/products/new", "/csv", "/templates", "/history", "/settings", "/help"];
  for (const p of pages) {
    const res = await httpGet(p);
    const ok = res.status === 200;
    record(`SSR ${p}`, ok, `HTTP ${res.status}`);
    if (!ok) console.log("   body:", (await res.text()).slice(0, 200).replace(/\n/g, " "));
  }

  // 5) 商品を1件 insert（Service Role で products テーブルへ。アプリの保存と同じ列構成）
  const insertRow = {
    user_id: user.id,
    ne_code: "e2e-2542-1", jan_code: "4955028002542", maker_code: "e2e",
    product_type: "単品", quantity: 1,
    product_name: "E2Eテスト商品 720ml", display_name: "E2E 巨人ボトル 720ml 25度",
    tax_rate: 10, cost_price: 0, selling_price: 10000,
    shipping_type: "送料無料", image_count: 3, delivery_method: 4, lead_time: 1,
    mall_category_id: "402930", store_category: "沖縄のお酒",
    yahoo_category_id: "41383", yahoo_path: "沖縄のお酒", unit: "本",
    yahoo_grouping_enabled: false, yahoo_variation_title: "数量",
    catch_copy_pc: "毎年完売必須 プロ野球 人気のボトル", catch_copy_yahoo: "毎年完売 プロ野球ボトル",
    description_pc: "<p>E2E テスト商品の説明 PC</p>", description_sp: "<p>E2E テスト商品の説明 SP</p>",
    extra: {},
  };
  const { data: inserted, error: insErr } = await admin
    .from("products").insert(insertRow).select().single();
  if (insErr || !inserted) { record("insert product", false, insErr ? insErr.message : "no row"); return finish(); }
  const productId = inserted.id;
  record("insert product", true, `id=${productId.slice(0, 8)}…`);

  // 6) 商品編集ページ /products/[id] SSR（プレビューもこのページ内で描画される）
  {
    const res = await httpGet(`/products/${productId}`);
    const ok = res.status === 200;
    let detail = `HTTP ${res.status}`;
    if (ok) {
      const html = await res.text();
      const hasPreview = html.includes("E2E") || html.includes("プレビュー");
      detail += hasPreview ? "  preview描画OK" : "  ⚠preview要素未検出";
    }
    record("SSR /products/[id] (preview含む)", ok, detail);
  }

  // 7) 全モール CSV を実ダウンロード（API ルート + 各 Converter + writeCsv を通す）
  const malls = ["rakuten", "yahoo", "ne_single", "ne_set", "shopify"];
  for (const mall of malls) {
    const res = await httpGet(`/api/csv/${mall}/${productId}`);
    const ok = res.status === 200;
    let detail = `HTTP ${res.status}`;
    if (ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const cd = res.headers.get("content-disposition") || "";
      detail += `  ${buf.length} bytes  ${cd.replace(/.*filename=/, "")}`;
      // ne_set は単品商品だと 0 行=0 bytes が正常仕様（NEConverter が単品を sets に入れないため）。
      // それ以外のモールで 0 bytes なら異常。
      if (buf.length === 0 && mall !== "ne_set") record(`CSV ${mall} 中身`, false, "0 bytes (異常)");
    } else {
      detail += "  " + (await res.text()).slice(0, 120);
    }
    record(`CSV ${mall}`, ok, detail);
  }

  // 8) 後始末: テスト商品を削除
  const { error: delErr } = await admin.from("products").delete().eq("id", productId);
  record("cleanup delete", !delErr, delErr ? delErr.message : `deleted ${productId.slice(0, 8)}…`);

  finish();
}

function finish() {
  const fail = results.filter((r) => r && !r.ok);
  console.log("\n==== E2E 結果 ====");
  console.log(`合計 ${results.length} / 失敗 ${fail.length}`);
  if (fail.length) {
    console.log("失敗:", fail.map((f) => f.step).join(", "));
    process.exit(1);
  }
  console.log("🎉 全ステップ成功 — worker クラッシュなし・登録→プレビュー→CSV 完走");
  process.exit(0);
}

main().catch((e) => { console.error("E2E スクリプト自体が例外:", e); process.exit(3); });
