// しまのや全商品の Yahoo!ショッピング反映「事前調査」（読み取り専用・Yahooへの書き込みなし）。
// アプリの反映プレビュー GET /api/update/yahoo/:id を全商品に回し、不足情報・ブロッカーを収集する。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_survey.mjs   （BASE 既定 http://localhost:3001）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { dbRowToProductInput } from "../lib/product/repository.ts";

const BASE = process.env.BASE || "http://localhost:3001";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 対象: 楽天一括反映と同じ集合（楽天連携あり・重複は最新行のみ）
const { data: rows, error } = await admin.from("products").select("*");
if (error) throw error;
const linked = [];
for (const row of rows) {
  const input = dbRowToProductInput(row);
  const manage = input.rakuten_manage_number || (input.mall_listed?.rakuten ? input.ne_code : null);
  if (manage) linked.push({ row, input, manage });
}
linked.sort((a, b) => String(b.row.updated_at).localeCompare(String(a.row.updated_at)));
const byManage = new Map();
for (const t of linked) if (!byManage.has(t.manage)) byManage.set(t.manage, t);
let targets = [...byManage.values()].sort((a, b) => a.manage.localeCompare(b.manage));
// 既定: しまのや正式64リストに限定（2026-07-23 ユーザー裁定）。全商品を対象にする場合のみ ALL=1。
if (process.env.ALL !== "1") {
  const master = new Set(readFileSync(new URL("../../.codex-work/shimanoya-master/shimanoya-64.txt", import.meta.url), "utf8").split(/\r?\n/).filter(Boolean));
  targets = targets.filter((t) => master.has(t.manage));
}
console.log(`対象 ${targets.length}商品（Yahooへの書き込みは一切行いません）`);

// 所有者ごとにログインセッションを用意（RLS対応）
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
const cookieByUser = new Map();
for (const uid of new Set(targets.map((t) => t.row.user_id))) {
  const user = list.users.find((u) => u.id === uid);
  if (!user) { console.log(`所有者不明: ${uid}`); continue; }
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  cookieByUser.set(uid, [...jar].map(([n, v]) => `${n}=${v}`).join("; "));
}

const results = [];
let i = 0;
for (const t of targets) {
  i++;
  const label = `[${i}/${targets.length}] ${t.manage}`;
  const dbInfo = {
    ne_code: t.input.ne_code,
    yahooListed: t.input.mall_listed?.yahoo === true,
    hasCatchCopyYahoo: !!(t.input.catch_copy_yahoo ?? "").trim(),
    hasYahooCategory: !!(t.input.yahoo_category_id ?? "").trim(),
    subscriptionEnabled: t.input.subscription_enabled === true,
    hasYahooSubscription: !!(t.input.yahoo_subscription_type ?? "").toString().trim(),
    variantCount: (t.input.variants ?? []).length,
    yahooVariationMode: t.input.yahoo_variation_mode ?? "",
  };
  const cookie = cookieByUser.get(t.row.user_id);
  if (!cookie) { results.push({ manage: t.manage, ...dbInfo, previewOk: false, error: "所有者セッションなし" }); continue; }
  try {
    const pr = await fetch(`${BASE}/api/update/yahoo/${t.row.id}`, { headers: { Cookie: cookie } });
    const pj = await pr.json();
    if (!pr.ok || !pj.ok) {
      results.push({ manage: t.manage, ...dbInfo, previewOk: false, error: pj.error ?? `HTTP ${pr.status}` });
      console.log(`${label} NG: ${String(pj.error ?? pr.status).slice(0, 110)}`);
    } else {
      results.push({
        manage: t.manage, ...dbInfo, previewOk: true,
        hasChanges: pj.hasChanges, changedCount: (pj.changedFields ?? []).length,
        changedFields: (pj.changedFields ?? []).map((c) => c.field).slice(0, 20),
        advanced: pj.advanced ?? [], subscriptionErrors: pj.subscriptionErrors ?? [], skipped: pj.skipped ?? [],
      });
      const flags = [
        pj.hasChanges ? `変更${(pj.changedFields ?? []).length}` : "変更なし",
        (pj.advanced ?? []).length ? `advanced:${pj.advanced.length}` : "",
        (pj.subscriptionErrors ?? []).length ? `定期NG:${pj.subscriptionErrors.length}` : "",
      ].filter(Boolean).join(" / ");
      console.log(`${label} OK (${flags})`);
    }
  } catch (e) {
    results.push({ manage: t.manage, ...dbInfo, previewOk: false, error: String(e?.message ?? e) });
    console.log(`${label} 例外: ${String(e?.message ?? e).slice(0, 110)}`);
  }
  await sleep(300);
}

const outDir = path.join(path.resolve(import.meta.dirname, "..", ".."), ".codex-work", "shimanoya-yahoo-survey");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, ".gitignore"), "*\n", "utf8");
writeFileSync(path.join(outDir, "survey.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, total: targets.length, results }, null, 2), "utf8");

const notOnYahoo = results.filter((r) => String(r.error ?? "").includes("該当商品が存在しません"));
const otherNg = results.filter((r) => !r.previewOk && !String(r.error ?? "").includes("該当商品が存在しません"));
const withAdvanced = results.filter((r) => (r.advanced ?? []).length > 0);
const withSubErr = results.filter((r) => (r.subscriptionErrors ?? []).length > 0);
const withChanges = results.filter((r) => r.previewOk && r.hasChanges && !(r.advanced ?? []).length && !(r.subscriptionErrors ?? []).length);
const noChange = results.filter((r) => r.previewOk && !r.hasChanges);
console.log(`\n集計: 反映可能(差分あり) ${withChanges.length} / 変更なし ${noChange.length} / Yahooに商品なし ${notOnYahoo.length} / advanced保留 ${withAdvanced.length} / 定期NG ${withSubErr.length} / その他NG ${otherNg.length}`);
console.log(`DB側: catch_copy_yahoo なし ${results.filter((r) => !r.hasCatchCopyYahoo).length} / yahoo_category_id なし ${results.filter((r) => !r.hasYahooCategory).length} / 定期ON×Yahoo定期未設定 ${results.filter((r) => r.subscriptionEnabled && !r.hasYahooSubscription).length}`);
console.log(`→ ${path.join(outDir, "survey.json")}`);
