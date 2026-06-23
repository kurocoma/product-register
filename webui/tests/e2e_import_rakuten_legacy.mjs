// 楽天 非規約管理番号(maker-JAN下4桁以外)の取込E2E。実管理番号を保存してそのまま往復することを実機で検証。
//   DB商品(rakuten_manage_number="zzv-imp-legacy")作成 → register POST(モールに "zzv-imp-legacy" 作成)
//   → 元DB削除 → import POST {code:"zzv-imp-legacy"} → 作成商品で buildRakutenManageNumber が非規約管理番号を再現
//   → items.delete + DB削除。
// 前提: dev server が http://localhost:3000 で起動していること。
// 実行: npx tsx tests/e2e_import_rakuten_legacy.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { deleteItem } from "../lib/rakuten/item-client.ts";
import { dbRowToProductInput } from "../lib/product/repository.ts";
import { buildRakutenManageNumber } from "../lib/converters/rakuten-api.ts";

const BASE = "http://localhost:3000";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const get = (k) => process.env[k];
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"), ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NE = "zzz-2542-9";        // variant 管理番号(=取込後の NEコード。規約どおり)
const JAN = "4955028002542";
const MAKER = "zzz";
const MN = "zzv-imp-legacy";    // ★非規約な商品管理番号（maker-JAN下4桁ではない。但し楽天で使える文字）
const PRICE = 3000;
const NAME = "楽天レガシー取込E2E商品";

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  const cred = getRakutenCredentialsFromEnv();
  // 後始末（前回の残骸）
  await admin.from("products").delete().eq("user_id", user.id).eq("ne_code", NE);
  try { await deleteItem(cred, MN); } catch { /* noop */ }

  // セットアップ用DB商品: extra.rakuten_manage_number で非規約な管理番号を指定 → register がその管理番号で作成
  const prod = (await admin.from("products").insert({
    user_id: user.id, ne_code: NE, jan_code: JAN, maker_code: MAKER,
    product_type: "単品", quantity: 1, product_name: NAME, display_name: NAME,
    tax_rate: 10, cost_price: 0, selling_price: PRICE, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "553575",
    catch_copy_pc: "レガシーキャッチ", description_pc: "<p>レガシーPC</p>", description_sp: "<p>レガシーSP</p>",
    extra: {
      rakuten_manage_number: MN,
      attributes: [
        { item: "メーカー型番", value: "LGC-001", unit: "", requirement: "必須" },
        { item: "タイトル", value: "レガシーテスト", unit: "", requirement: "必須" },
        { item: "発売元", value: "テスト", unit: "", requirement: "必須" },
      ],
    },
  }).select("id").single()).data;
  check("セットアップ用DB商品作成", !!prod?.id, prod && prod.id.slice(0, 8));

  // セッション（magic-link）
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 1) register POST（非規約管理番号 "zzv-imp-legacy" を倉庫・非公開で作成）
  const reg = await fetch(`${BASE}/api/register/rakuten/${prod.id}`, { method: "POST", headers: H, body: "{}" });
  const regj = await reg.json();
  check("register POST 200(非規約管理番号で作成)", reg.status === 200 && regj.ok && regj.manageNumber === MN, `HTTP ${reg.status} ${JSON.stringify(regj).slice(0, 160)}`);
  await sleep(2000);

  // 2) 元DB商品を削除（import が新規作成パスを通る）
  await admin.from("products").delete().eq("id", prod.id);

  // 3) import POST {code} — 非規約管理番号で取込んで新規作成
  const imp = await fetch(`${BASE}/api/import/rakuten`, { method: "POST", headers: H, body: JSON.stringify({ code: MN }) });
  const impj = await imp.json();
  check("import POST 200(非規約でも取込可)", imp.status === 200 && impj.ok, `HTTP ${imp.status} ${JSON.stringify(impj).slice(0, 200)}`);
  check("existed=false(新規作成)", impj.existed === false, JSON.stringify(impj));
  check("返却 neCode=variant一致", impj.neCode === NE, impj.neCode);
  const createdId = impj.productId;

  // 4) 作成された商品を検証
  const { data: row } = await admin.from("products").select("*").eq("id", createdId).single();
  let product = null;
  try { product = dbRowToProductInput(row); check("dbRowToProductInput 成功(編集画面が壊れない)", true, ""); }
  catch (e) { check("dbRowToProductInput 成功(編集画面が壊れない)", false, String(e).slice(0, 160)); }
  if (product) {
    check("ne_code 一致", product.ne_code === NE, product.ne_code);
    check("jan_code は13桁・実JAN", product.jan_code === JAN, product.jan_code);
    check("★実管理番号を保存", product.rakuten_manage_number === MN, product.rakuten_manage_number);
    check("★buildRakutenManageNumber が非規約管理番号を再現", buildRakutenManageNumber(product) === MN, buildRakutenManageNumber(product));
    check("maker=NEコードから導出(zzz)", product.maker_code === MAKER, product.maker_code);
    check("selling_price 取込一致", product.selling_price === PRICE, String(product.selling_price));
    check("display_name 取込一致", product.display_name === NAME, product.display_name);
  }

  // 5) 後始末
  await sleep(800);
  const del = await deleteItem(cred, MN);
  check("items.delete 後始末", del.ok, `status=${del.status}`);
  await admin.from("products").delete().eq("id", createdId);
  check("作成商品DB削除", true, "");

  console.log(fail === 0 ? "\n🎉 楽天 非規約管理番号 取込E2E 成功（実管理番号で往復）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
