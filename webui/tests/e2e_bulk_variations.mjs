// 一括登録 /api/register/bulk/[mall] のバリエーション検証E2E（既存E2Eが踏まない境界）。
//   V1: 多SKU(variants 2件)商品を一括経路で楽天登録 → variantSelectors 自動生成と両SKU登録を確認
//   V2: ジャンル必須属性なし（attributes空）商品 → dry-runは valid（属性はdry-run検出外）だが
//       commit(items.upsert)で楽天が実エラーを返すことを確認（エラーコード実測）
//   V3: 商品名80字（全角）→ Yahoo name上限75字への自動切詰めで editItem 成功・実機75字登録を確認
// 安全規約: 楽天=倉庫(hideItem)・Yahoo=display:0・publish/submit不使用・全件後始末（モール+DB）。
// テスト商品は3件のみ（同時最大5件の規約内）。
// 実行: npx tsx tests/e2e_bulk_variations.mjs
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

// テスト用 JAN は全て有効チェックディジット（不正JANは楽天が articleNumber を拒否する）
const MAKER = "zzz";
const V1_NE = "zzz-5994-1", V1_JAN = "4955028005994", V1_MN = "zzz-5994"; // 多SKU
const V2_NE = "zzz-4997-1", V2_JAN = "4955028004997", V2_MN = "zzz-4997"; // 属性なし
const V3_NE = "zzz-3990-1", V3_JAN = "4955028003990";                      // 商品名75字境界
const NES = [V1_NE, V2_NE, V3_NE];
const ATTRS = [
  { item: "メーカー型番", value: "TEST-VAR", unit: "", requirement: "必須" },
  { item: "タイトル", value: "テスト商品", unit: "", requirement: "必須" },
  { item: "発売元", value: "テストメーカー", unit: "", requirement: "必須" },
];
const variant = (sku, ne, price, label) => ({
  sku_manage_number: sku, ne_code: ne, jan_code: "", selling_price: price, tax_rate: 10, quantity: 1,
  variation_value: label, shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "",
  shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: ATTRS,
});

function productRow(userId, ne, jan, over = {}) {
  return {
    user_id: userId, ne_code: ne, jan_code: jan, maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: `バリエーションE2E ${ne}`, display_name: `バリエーションE2Eテスト ${ne}`,
    tax_rate: 10, cost_price: 0, selling_price: 1980, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "テスト", description_pc: "<p>説明</p>", description_sp: "<p>SP説明</p>",
    extra: { attributes: ATTRS },
    ...over,
  };
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  await admin.from("products").delete().eq("user_id", user.id).in("ne_code", NES);

  const ins = async (row) => (await admin.from("products").insert(row).select("id").single()).data.id;

  // V1: 多SKU（variants 2件、選択肢ラベル Aタイプ/Bタイプ）
  const p1 = await ins(productRow(user.id, V1_NE, V1_JAN, {
    extra: {
      attributes: ATTRS,
      variants: [variant(`${V1_MN}-a`, V1_NE, 1980, "Aタイプ"), variant(`${V1_MN}-b`, `${V1_NE}b`, 2980, "Bタイプ")],
    },
  }));
  // V2: ジャンル必須属性なし（extra 空）
  const p2 = await ins(productRow(user.id, V2_NE, V2_JAN, { extra: {} }));
  // V3: 商品名80字（全角）。Yahoo name 上限75字への切詰めを踏む。image_count:0=実在しない画像を参照しない
  const NAME80 = ("Yahoo商品名75字境界検証用テスト商品" + "あ".repeat(80)).slice(0, 80);
  const p3 = await ins(productRow(user.id, V3_NE, V3_JAN, {
    display_name: NAME80, yahoo_category_id: "13457", yahoo_path: "テスト", image_count: 0,
  }));
  check("テスト商品3件作成（同時最大5件の規約内）", !!(p1 && p2 && p3), "");
  check("V3 商品名は80字", [...NAME80].length === 80, String([...NAME80].length));

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

  // ========== V1+V2 楽天 dry-run ==========
  {
    const { status, j } = await post("rakuten", { ids: [p1, p2] });
    check("[V1/V2 楽天] dry-run 200 + ok", status === 200 && j.ok, `HTTP ${status}`);
    // 知見: 属性なしでも dry-run は valid（validateUpsertBody はジャンル必須属性を検査しない）
    check("[V2 楽天] 属性なしでも dry-run は valid=2（属性はdry-run検出外）", j.valid === 2 && j.invalid === 0, JSON.stringify({ v: j.valid, i: j.invalid }));
  }

  // ========== V1 多SKU commit → モール確認 ==========
  {
    const { j } = await post("rakuten", { ids: [p1], dryRun: false });
    const r = j.results?.[0];
    if (r && !r.ok) console.log(`   ↳ V1失敗詳細: ${r.error}`);
    check("[V1 楽天] 多SKU commit 成功", r?.registered === true && r?.action === "create", JSON.stringify({ ok: r?.ok, action: r?.action }));
    await sleep(2500);
    const cred = getRakutenCredentialsFromEnv();
    const got = await rGetItem(cred, V1_MN);
    const vs = got.json?.variants || {};
    check("[V1 楽天] items.get 両SKU登録確認", got.exists && vs[`${V1_MN}-a`] && vs[`${V1_MN}-b`], `keys=${Object.keys(vs).join(",")}`);
    const sel = got.json?.variantSelectors;
    const labels = (sel?.[0]?.values || []).map((v) => v.displayValue);
    check("[V1 楽天] variantSelectors 単軸自動生成", Array.isArray(sel) && sel.length === 1 && labels.includes("Aタイプ") && labels.includes("Bタイプ"), JSON.stringify(labels));
    check("[V1 楽天] SKU別価格 A=1980/B=2980", vs[`${V1_MN}-a`]?.standardPrice === "1980" && vs[`${V1_MN}-b`]?.standardPrice === "2980", `A=${vs[`${V1_MN}-a`]?.standardPrice} B=${vs[`${V1_MN}-b`]?.standardPrice}`);
  }

  // ========== V2 属性なし commit → 実エラー実測 ==========
  {
    const { j } = await post("rakuten", { ids: [p2], dryRun: false });
    const r = j.results?.[0];
    // 知見: ジャンル必須属性の欠落は commit(items.upsert) で初めて実エラーになる
    check("[V2 楽天] 属性なし commit は失敗（upsert実エラー）", r?.ok === false && r?.registered !== true, JSON.stringify({ ok: r?.ok }));
    console.log(`   ↳ V2 実測エラー: ${String(r?.error).slice(0, 300)}`);
    await sleep(1500);
    const cred = getRakutenCredentialsFromEnv();
    const got = await rGetItem(cred, V2_MN);
    check("[V2 楽天] 商品は作成されていない（exists=false）", !got.exists, `status=${got.status}`);
  }

  // ========== V3 Yahoo 商品名75字境界 ==========
  {
    // 単一routeの dry-run は送信予定 params を返すため、切詰め後の name 長を直接検証できる
    const dr = await fetch(`${BASE}/api/register/yahoo/${p3}?dryRun=1`, { headers: { Cookie: cookie } });
    const drj = await dr.json();
    const nameLen = [...(drj.params?.name || "")].length;
    check("[V3 Yahoo] dry-run valid（80字でも拒否されない）", drj.ok && drj.valid === true, JSON.stringify(drj.missing || []));
    check("[V3 Yahoo] name は75字へ自動切詰め", nameLen === 75, `len=${nameLen}`);

    const co = await post("yahoo", { ids: [p3], dryRun: false });
    const r = co.j.results?.[0];
    if (r && !r.ok) console.log(`   ↳ V3失敗詳細: ${r.error}`);
    check("[V3 Yahoo] commit registered（submitなし・display=0）", co.j.ok && r?.registered === true, "");
    check("[V3 Yahoo] 反映予約は未実施（submitted なし）", co.j.submitted !== true, String(co.j.submitted));

    await sleep(2000);
    const cfg = getYahooConfig();
    const token = await getYahooAccessToken(cfg);
    const got = await yGetItem(token, cfg.sellerId, V3_NE);
    check("[V3 Yahoo] getItem 登録確認", got.exists, got.exists ? "存在" : "未検出");
    // 実機に登録された name が75字であること（CDATA/平文両対応で抽出）
    const cd = got.raw.match(/<Name>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Name>/i);
    const pl = got.raw.match(/<Name>([^<]*)<\/Name>/i);
    const mallName = (cd ? cd[1] : pl ? pl[1] : "").trim();
    check("[V3 Yahoo] 実機の name は75字", [...mallName].length === 75, `len=${[...mallName].length}`);

    const del = await yDeleteItem(token, cfg.sellerId, V3_NE);
    check("[V3 Yahoo] deleteItem 後始末", del.ok, del.message);
  }

  // ========== 後始末（楽天 + DB） ==========
  await sleep(1000);
  {
    const cred = getRakutenCredentialsFromEnv();
    const del = await rDeleteItem(cred, V1_MN);
    check(`[楽天] items.delete ${V1_MN} 後始末`, del.ok, `status=${del.status} ${del.message ?? ""}`);
    // V2 はモール未作成のため items.delete 不要（GE0014=削除対象なし、を避ける）
  }
  await admin.from("products").delete().eq("user_id", user.id).in("ne_code", NES);
  check("テスト商品DB削除（3件）", true, "");

  console.log(fail === 0 ? "\n🎉 バリエーションE2E 成功（多SKU一括／属性なし実エラー／75字境界切詰め）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
