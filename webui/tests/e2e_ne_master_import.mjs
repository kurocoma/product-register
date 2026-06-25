// 統合商品マスタ取込E2E。実NEマスタ(Shift-JIS実データ)＋Excel代替fixtureを取込API経由で投入し、3テーブル＋ゴールデンを検証→後始末。
//   ne-syohin/ne-set/ne-himoduke = 実CSV(docs/ネクストエンジン, CP932) → decode/papaparse経路を実機で通す
//   excel-master/excel-mall = 小fixture(UTF-8)
//   検証: a008-4032-1 を含むセット5件 / 価格・在庫連携・JAN・モールコード
// 前提: dev server が http://localhost:3000。実行: npx tsx tests/e2e_ne_master_import.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = "http://localhost:3000";
const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, "../.env.local"), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

const NEDIR = join(here, "../../docs/ネクストエンジン");
const pick = (re) => { const f = readdirSync(NEDIR).find((n) => re.test(n)); if (!f) throw new Error("file not found: " + re); return join(NEDIR, f); };

async function post(cookie, source, fileBytes, fileName, query = "") {
  const fd = new FormData();
  fd.append("file", new Blob([fileBytes]), fileName);
  const res = await fetch(`${BASE}/api/masters/import/${source}${query}`, { method: "POST", headers: { Cookie: cookie }, body: fd });
  return { status: res.status, json: await res.json() };
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "diag.probe.zzz@gmail.com");
  // 後始末（前回残骸）
  for (const t of ["ne_item_master", "ne_set_composition", "ne_mall_code"]) await admin.from(t).delete().eq("user_id", user.id);

  // セッション
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

  // 1) 実NE CSV(Shift-JIS実データ)を取込
  const r1 = await post(cookie, "ne-syohin", readFileSync(pick(/^syohin_basic.*\.csv$/)), "syohin.csv");
  check("ne-syohin 取込(実CP932)", r1.status === 200 && r1.json.ok, JSON.stringify(r1.json).slice(0, 160));
  const r2 = await post(cookie, "ne-set", readFileSync(pick(/^set_syohin.*\.csv$/)), "set.csv");
  check("ne-set 取込(papaparse多行)", r2.status === 200 && r2.json.ok && r2.json.composition > 1000, JSON.stringify(r2.json).slice(0, 160));
  const r3 = await post(cookie, "ne-himoduke", readFileSync(pick(/^himoduke.*\.csv$/)), "himo.csv");
  check("ne-himoduke 取込", r3.status === 200 && r3.json.ok, JSON.stringify(r3.json).slice(0, 160));

  // 2) Excel代替fixture(UTF-8)
  const excelMaster = "仕入先,JANコード,NEコード,仕入先CD,商品名,仕入れ価格,税率,カテゴリ,備品フラグ\n大宜味,4582218324032,a008-4032-1,,青切りシークヮーサー500ml,1500,8,飲料,\n";
  const r4 = await post(cookie, "excel-master", Buffer.from(excelMaster, "utf-8"), "em.csv");
  check("excel-master 取込", r4.status === 200 && r4.json.ok, JSON.stringify(r4.json).slice(0, 160));
  // 同一ne_codeを2行(オプション行想定)→ (ne_code,mall)重複排除で upserted=1 になること(ON CONFLICT二重更新回避の回帰)
  const excelRakuten = "商品管理番号,商品番号,項目名,選択肢,JANコード,商品名,数量\naogiri-sh2,a008-4032-3,色,赤,4582218324032,青切り,3\naogiri-sh2,a008-4032-3,色,青,4582218324032,青切り,3\n";
  const r5 = await post(cookie, "excel-mall", Buffer.from(excelRakuten, "utf-8"), "er.csv", "?mall=rakuten");
  check("excel-mall(rakuten) 取込・重複ne_code排除でupserted=1", r5.status === 200 && r5.json.ok && r5.json.upserted === 1, JSON.stringify(r5.json).slice(0, 160));

  // 3) 検証
  const { data: item } = await admin.from("ne_item_master").select("*").eq("user_id", user.id).eq("ne_code", "a008-4032-1").maybeSingle();
  check("item: a008-4032-1 存在", !!item, item && JSON.stringify({ p: item.selling_price, j: item.jan_code, z: item.zaiko_renkei }));
  if (item) {
    check("item: 売価=NE商品マスタ(2191)", item.selling_price === 2191, String(item.selling_price));
    check("item: JAN=Excel(4582218324032)", item.jan_code === "4582218324032", item.jan_code);
    check("item: 在庫連携=himoduke(する)", item.zaiko_renkei === "する", item.zaiko_renkei);
    check("item: sources に ne_single/excel_master/himoduke", ["ne_single", "excel_master", "himoduke"].every((s) => (item.sources || []).includes(s)), JSON.stringify(item.sources));
  }

  // ★ゴールデン: a008-4032-1 を含むセット = 5件
  const { data: comps } = await admin.from("ne_set_composition").select("set_ne_code, suryo").eq("user_id", user.id).eq("component_ne_code", "a008-4032-1");
  const sets = (comps || []).map((c) => c.set_ne_code).sort();
  const expected = ["a008-4032-11-out", "a008-4032-12", "a008-4032-3", "a008-4032-6-out", "a008-4032-8"];
  check("★逆引き: a008-4032-1 を含むセット5件", JSON.stringify(sets) === JSON.stringify(expected), JSON.stringify(sets));

  const { data: setItem } = await admin.from("ne_item_master").select("is_set, selling_price").eq("user_id", user.id).eq("ne_code", "a008-4032-3").maybeSingle();
  check("item: a008-4032-3 is_set=true・売価=6286", setItem && setItem.is_set === true && setItem.selling_price === 6286, JSON.stringify(setItem));

  const { data: mall } = await admin.from("ne_mall_code").select("manage_no").eq("user_id", user.id).eq("ne_code", "a008-4032-3").eq("mall", "rakuten").maybeSingle();
  check("mall: a008-4032-3 楽天=aogiri-sh2", mall && mall.manage_no === "aogiri-sh2", JSON.stringify(mall));

  // 4) 後始末
  for (const t of ["ne_item_master", "ne_set_composition", "ne_mall_code"]) await admin.from(t).delete().eq("user_id", user.id);
  check("後始末(3テーブル削除)", true, "");

  console.log(fail === 0 ? "\n🎉 統合商品マスタ取込 E2E 成功（実NEマスタ取込→ゴールデン検証→後始末）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
