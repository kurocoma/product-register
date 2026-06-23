// 楽天 既存商品編集(部分更新)のE2E。実フロー: register(作成)→fetch(取込)→価格変更→update(部分反映)。
//   register POST → fetch POST(モール現状をアプリへ取込) → DBで価格1980→3980 → update GET(diff=価格のみ)
//   → update POST(items.patch) → items.get(価格3980・title/sp不変) → items.delete + DB削除。
// 前提: dev server が http://localhost:3000 で起動していること。
// 実行: npx tsx tests/e2e_update_rakuten.mjs
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

const NE = "zzz-updr-1";       // variant 管理番号
const JAN = "4955028002542";    // 13桁(末尾2542)→ baseCode=zzz-2542 ... 既存e2eと衝突回避のため maker を zzu に
const MAKER = "zzu";
const MN = "zzu-2542";          // baseCodeOf(maker=zzu, jan末尾2542)

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cred = getRakutenCredentialsFromEnv();
  // 後始末（前回の残骸）
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  try { await deleteItem(cred, MN); } catch { /* noop */ }

  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: JAN, maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: "楽天更新E2E", display_name: "楽天更新E2E商品",
    tax_rate: 10, cost_price: 0, selling_price: 1980, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "初期キャッチ", description_pc: "<p>初期PC</p>", description_sp: "<p>初期SP</p>",
    extra: { attributes: [
      { item: "メーカー型番", value: "UPD-001", unit: "", requirement: "必須" },
      { item: "タイトル", value: "更新テスト", unit: "", requirement: "必須" },
      { item: "発売元", value: "テスト", unit: "", requirement: "必須" },
    ] },
  }).select("id").single()).data;
  check("テスト商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  // セッション
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) register POST（倉庫・非公開で作成、価格1980）
  const reg = await fetch(`${BASE}/api/register/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const regj = await reg.json();
  check("register POST 200", reg.status === 200 && regj.ok, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 160)}`);
  await sleep(2000);

  // 2) fetch POST（モール現状をアプリへ取込 → app と mall を一致させる）
  const fe = await fetch(`${BASE}/api/fetch/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const fej = await fe.json();
  check("fetch POST 200(取込)", fe.status === 200 && fej.ok, `HTTP ${fe.status} ${JSON.stringify(fej).slice(0, 160)}`);

  // 3) アプリ側で価格だけ 1980 → 3980 に変更
  await admin.from("products").update({ selling_price: 3980 }).eq("id", prod.id);

  // 4) update GET（dry-run）= 差分は selling_price のみ
  const dr = await fetch(`${BASE}/api/update/rakuten/${prod.id}`, { headers: { Cookie: cookie } });
  const drj = await dr.json();
  check("update GET 200", dr.status === 200 && drj.ok, `HTTP ${dr.status}`);
  check("差分は selling_price のみ", drj.hasChanges && drj.changedFields.length === 1 && drj.changedFields[0].field === "selling_price", JSON.stringify(drj.changedFields));
  check("送信ボディ standardPrice=3980", drj.willSend?.variants?.[NE]?.standardPrice === "3980", JSON.stringify(drj.willSend?.variants));

  // 5) update POST（items.patch 実行）
  const up = await fetch(`${BASE}/api/update/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const upj = await up.json();
  check("update POST 200(patch)", up.status === 200 && upj.ok, `HTTP ${up.status} ${JSON.stringify(upj).slice(0, 160)}`);
  await sleep(2000);

  // 6) items.get 反映確認: 価格3980・title/sp不変
  const got = await getItem(cred, MN);
  check("items.get 取得", got.exists, `status=${got.status}`);
  const after = parseRakutenItem(got.json);
  check("価格3980に反映", after.selling_price === 3980, String(after.selling_price));
  check("title 不変", after.display_name === "楽天更新E2E商品", after.display_name);
  check("PC説明 不変", after.description_pc === "<p>初期PC</p>", after.description_pc);

  // 7) 後始末
  await sleep(800);
  const del = await deleteItem(cred, MN);
  check("items.delete 後始末", del.ok, `status=${del.status}`);
  await admin.from("products").delete().eq("id", prod.id);
  check("テスト商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 楽天 既存商品編集 E2E 成功（register→fetch→update部分反映）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
