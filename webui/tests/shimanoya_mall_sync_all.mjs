// 楽天連携済みの全商品をアプリの反映ルート(/api/update/rakuten)で一括反映し、エラーを収集する。
// ユーザー承認(2026-07-23):「他の全商品反映してみていいよ。エラー出る商品がないかチェックして」。
// ルート経由なので差分判定・自動補正・履歴記録・エラー日本語説明がそのまま効く（AI操作マニュアル §5 経路②）。
// 実行: cd webui && npx tsx tests/shimanoya_mall_sync_all.mjs   （BASE は既定 http://localhost:3001）
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

// --- 対象商品: 楽天連携あり。重複(同じ楽天管理番号)は updated_at 最新の行だけ反映する ---
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
const dupSkipped = [];
for (const t of linked) {
  if (byManage.has(t.manage)) dupSkipped.push({ manage: t.manage, id: t.row.id, updated_at: t.row.updated_at });
  else byManage.set(t.manage, t);
}
let targets = [...byManage.values()].sort((a, b) => a.manage.localeCompare(b.manage));
// ONLY=r7201-1,r8801-0 のようにカンマ区切りで対象を絞り込める（再実行用）
if (process.env.ONLY) {
  const only = new Set(process.env.ONLY.split(",").map((s) => s.trim()).filter(Boolean));
  targets = targets.filter((t) => only.has(t.manage));
}
console.log(`対象: 楽天連携 ${linked.length}行 → 反映 ${targets.length}商品（古い重複 ${dupSkipped.length}行はスキップ）`);
for (const d of dupSkipped) console.log(`  重複スキップ: ${d.manage} (${d.id.slice(0, 8)}… / ${d.updated_at})`);

// --- ログインセッション（magiclink → cookie） ---
// LOGIN_EMAIL でログインアカウントを指定できる（複数アカウント運用のため。既定は対象1件目の所有者）
const ownerId = targets[0]?.row.user_id;
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
const user = process.env.LOGIN_EMAIL
  ? list.users.find((u) => u.email === process.env.LOGIN_EMAIL)
  : (list.users.find((u) => u.id === ownerId) ?? list.users.find((u) => u.email === "kmzt.i-0001@kurocommerce.com"));
if (!user) throw new Error("所有者ユーザーが見つからない");
const jar = new Map();
const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");

// --- 反映ループ: GET(プレビュー) → 変更ありなら POST(確定) ---
const results = [];
let i = 0;
for (const t of targets) {
  i++;
  const label = `[${i}/${targets.length}] ${t.manage}`;
  try {
    const pr = await fetch(`${BASE}/api/update/rakuten/${t.row.id}`, { headers: { Cookie: cookie } });
    const pj = await pr.json();
    if (!pr.ok || !pj.ok) {
      results.push({ manage: t.manage, id: t.row.id, phase: "preview", ok: false, error: pj.error ?? `HTTP ${pr.status}` });
      console.log(`${label} プレビューNG: ${String(pj.error ?? pr.status).slice(0, 140)}`);
      continue;
    }
    if (!pj.hasChanges) {
      results.push({ manage: t.manage, id: t.row.id, phase: "preview", ok: true, noChange: true });
      console.log(`${label} 変更なし`);
      continue;
    }
    const po = await fetch(`${BASE}/api/update/rakuten/${t.row.id}`, {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}",
    });
    const oj = await po.json();
    if (!po.ok || !oj.ok) {
      results.push({ manage: t.manage, id: t.row.id, phase: "apply", ok: false, error: oj.error ?? `HTTP ${po.status}`, changedFields: pj.changedFields?.map((c) => c.field) });
      console.log(`${label} 反映NG: ${String(oj.error ?? po.status).slice(0, 200)}`);
    } else {
      results.push({ manage: t.manage, id: t.row.id, phase: "apply", ok: true, changedFields: oj.changedFields, skipped: oj.skipped });
      console.log(`${label} 反映OK (${(oj.changedFields ?? []).length}項目)`);
    }
  } catch (e) {
    results.push({ manage: t.manage, id: t.row.id, phase: "exception", ok: false, error: String(e?.message ?? e) });
    console.log(`${label} 例外: ${String(e?.message ?? e).slice(0, 140)}`);
  }
  await sleep(250);
}

const outDir = path.join(path.resolve(import.meta.dirname, "..", ".."), ".codex-work", "shimanoya-mall-sync");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, ".gitignore"), "*\n", "utf8");
const okApply = results.filter((r) => r.ok && r.phase === "apply").length;
const noChange = results.filter((r) => r.noChange).length;
const ng = results.filter((r) => !r.ok);
writeFileSync(path.join(outDir, "sync-result.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, total: targets.length, okApply, noChange, ng: ng.length, dupSkipped, results }, null, 2), "utf8");
console.log(`\n完了: 反映OK ${okApply} / 変更なし ${noChange} / エラー ${ng.length} → .codex-work/shimanoya-mall-sync/sync-result.json`);
for (const r of ng) console.log(`  NG ${r.manage} [${r.phase}]: ${String(r.error).slice(0, 200)}`);
