// 関連商品抽出(Phase 2)E2E。実NEマスタ(単品+セット)取込→ n050-3426-1 検索→含むセット8件(受け入れ)を検証→後始末。
// 前提: dev server が http://localhost:3000。実行: npx tsx tests/e2e_ne_master_related.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { relatedToCsv } from "../lib/ne-master/related.ts";

const BASE = "http://localhost:3000";
const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, "../.env.local"), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };
const NEDIR = join(here, "../../docs/ネクストエンジン");
const pick = (re) => join(NEDIR, readdirSync(NEDIR).find((n) => re.test(n)));

async function postFile(cookie, source, path, name) {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(path)]), name);
  const res = await fetch(`${BASE}/api/masters/import/${source}`, { method: "POST", headers: { Cookie: cookie }, body: fd });
  return { status: res.status, json: await res.json() };
}

const GOLDEN = ["4582469493006-4582469493402", "4582469493013-4582469493402", "IL-4CUI-5DAZ", "S0-9ZH5-06U1", "n050-3013-s01", "n050-3402-s01", "n050-3419-s01", "n050-8049-s01"];

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com");
  for (const t of ["ne_item_master", "ne_set_composition", "ne_mall_code"]) await admin.from(t).delete().eq("user_id", user.id);

  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  // 取込（単品+セット。検索の土台）
  const i1 = await postFile(cookie, "ne-syohin", pick(/^syohin_basic.*\.csv$/), "syohin.csv");
  check("ne-syohin 取込", i1.json.ok, JSON.stringify(i1.json).slice(0, 120));
  const i2 = await postFile(cookie, "ne-set", pick(/^set_syohin.*\.csv$/), "set.csv");
  check("ne-set 取込", i2.json.ok, JSON.stringify(i2.json).slice(0, 120));
  // JAN検索の土台: Excel商品マスタ由来のJANを item_master へ（n050-3426-1 → 4582469493426）
  const em = "仕入先,JANコード,NEコード,仕入先CD,商品名,仕入れ価格,税率,カテゴリ,備品フラグ\nファイントゥデイ,4582469493426,n050-3426-1,,MARO17 スカルプコンディショナー 詰替 300ml,814,10,日用品,\n";
  const fd = new FormData(); fd.append("file", new Blob([Buffer.from(em, "utf-8")]), "em.csv");
  const i3 = await fetch(`${BASE}/api/masters/import/excel-master`, { method: "POST", headers: { Cookie: cookie }, body: fd });
  check("excel-master 取込(JAN付与)", (await i3.json()).ok, "");

  // 検索: 商品コードで
  const r1 = await fetch(`${BASE}/api/masters/related`, { method: "POST", headers: H, body: JSON.stringify({ input: "n050-3426-1" }) });
  const j1 = await r1.json();
  check("related POST 200", r1.status === 200 && j1.ok, `HTTP ${r1.status}`);
  const codes = (j1.sets || []).map((s) => s.set_ne_code).sort();
  check("★含むセット = 受け入れ8件(完全一致)", JSON.stringify(codes) === JSON.stringify(GOLDEN), JSON.stringify(codes));

  // 1セットの詳細(n050-3419-s01: 販売3120・n050-3426-1を含む・構成2品)
  const s = (j1.sets || []).find((x) => x.set_ne_code === "n050-3419-s01");
  check("セット詳細 n050-3419-s01: 販売3120", s && s.set_price === 3120, s && String(s.set_price));
  check("セット詳細: n050-3426-1 を含む", s && s.components.some((c) => c.ne_code === "n050-3426-1"), s && JSON.stringify(s.components));
  check("セット詳細: 元単品=n050-3426-1", s && s.matched_singles.includes("n050-3426-1"), s && JSON.stringify(s.matched_singles));

  // 検索: JANで(同単品に解決→8件を含む)
  const r2 = await fetch(`${BASE}/api/masters/related`, { method: "POST", headers: H, body: JSON.stringify({ input: "4582469493426" }) });
  const j2 = await r2.json();
  const codes2 = new Set((j2.sets || []).map((s2) => s2.set_ne_code));
  check("JAN検索: 受け入れ8件を全て含む", GOLDEN.every((g) => codes2.has(g)), `件数=${codes2.size}`);

  // CSV組立(クライアント相当)
  const csv = relatedToCsv(j1.sets);
  check("CSV: ヘッダ+8行", csv.trim().split("\r\n").length === 9, String(csv.trim().split("\r\n").length));

  // 後始末
  for (const t of ["ne_item_master", "ne_set_composition", "ne_mall_code"]) await admin.from(t).delete().eq("user_id", user.id);
  check("後始末", true, "");

  console.log(fail === 0 ? "\n🎉 関連商品抽出 E2E 成功（n050-3426-1→受け入れ8セット）" : `\n⚠ ${fail}件失敗`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("例外:", e); process.exit(3); });
